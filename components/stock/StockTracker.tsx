"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  COUNTRIES,
  MODELS,
  STORAGE_LABELS,
  getCountry,
  type ColorId,
  type CountryCode,
  type Storage,
  type Variant,
} from "@/lib/apple-stock/catalog";
import {
  notificationState,
  playChime,
  requestNotifications,
  sendNtfy,
  showNotification,
  type NotificationState,
} from "@/lib/apple-stock/notify";
import type { StockError, StockResponse } from "@/lib/apple-stock/types";
import StoreCard from "./StoreCard";

const SETTINGS_KEY = "apple-stock-tracker:v1";
const MAX_VARIANTS = 4;
const INTERVALS = [1, 2, 5, 10];

interface Settings {
  country: CountryCode;
  modelId: string;
  colors: ColorId[];
  storages: Storage[];
  location: string;
  intervalMin: number;
  excludedStores: string[];
  ntfyTopic: string;
  sound: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  country: "fr",
  modelId: "iphone-duo",
  colors: ["night-sky"],
  storages: ["256"],
  location: "75001",
  intervalMin: 2,
  excludedStores: [],
  ntfyTopic: "",
  sound: true,
};

interface LogEntry {
  at: Date;
  kind: "ok" | "alert" | "error";
  text: string;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const noopSubscribe = () => () => {};

export default function StockTracker() {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return isClient ? <Tracker /> : <Shell />;
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(56,189,248,0.18),transparent_70%)]" />
      <div className="pointer-events-none absolute -right-40 top-40 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />
      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 sm:px-8">
        <div className="mb-10">
          <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-300">
            ← Lycapps
          </Link>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-xs font-medium text-zinc-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
            Données en direct d&apos;apple.com
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            iPhone Duo en Apple Store
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-zinc-400">
            Vérifiez le retrait en magasin près de chez vous et soyez prévenu dès que votre
            configuration arrive en stock.
          </p>
        </div>
        {children}
      </main>
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-sky-400/60 bg-sky-400/10 text-white"
          : "border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600"
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      {children}
    </div>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Tracker() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [data, setData] = useState<StockResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [watching, setWatching] = useState(false);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [permission, setPermission] = useState<NotificationState>(notificationState);
  const [log, setLog] = useState<LogEntry[]>([]);
  const alertedRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const country = getCountry(settings.country) ?? COUNTRIES[0];
  const model = MODELS.find((m) => m.id === settings.modelId) ?? MODELS[0];
  const countryVariants: Variant[] = useMemo(
    () => model.variantsByCountry[country.code] ?? [],
    [model, country.code],
  );
  const selectedVariants = useMemo(() => {
    if (model.reference) return countryVariants.slice(0, 1);
    return countryVariants
      .filter((v) => settings.colors.includes(v.color) && settings.storages.includes(v.storage))
      .slice(0, MAX_VARIANTS);
  }, [countryVariants, model.reference, settings.colors, settings.storages]);
  const tooMany =
    !model.reference && settings.colors.length * settings.storages.length > MAX_VARIANTS;

  const priceFormat = useMemo(
    () => new Intl.NumberFormat(country.locale, { style: "currency", currency: country.currency, maximumFractionDigits: 0 }),
    [country],
  );

  const variantLabel = useCallback(
    (partNumber: string, fallback: string) => {
      const v = countryVariants.find((x) => x.partNumber === partNumber);
      if (!v) return fallback;
      const color = model.colors.find((c) => c.id === v.color)?.label;
      return `${model.name.replace(" (témoin)", "")} ${STORAGE_LABELS[v.storage]} · ${color}`;
    },
    [countryVariants, model],
  );

  const pushLog = (entry: Omit<LogEntry, "at">) =>
    setLog((l) => [{ ...entry, at: new Date() }, ...l].slice(0, 30));

  const latest = useRef({ settings, selectedVariants, variantLabel });
  useEffect(() => {
    latest.current = { settings, selectedVariants, variantLabel };
  });

  const check = useCallback(async (): Promise<number | undefined> => {
    const { settings: s, selectedVariants: variants, variantLabel: label } = latest.current;
    if (!variants.length || !s.location.trim()) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        country: s.country,
        location: s.location.trim(),
        parts: variants.map((v) => v.partNumber).join(","),
      });
      const res = await fetch(`/api/apple-stock?${qs}`);
      const json = (await res.json()) as StockResponse | StockError;
      if (!res.ok || "error" in json) {
        const err = json as StockError;
        setError(err.error);
        pushLog({ kind: "error", text: err.error });
        return err.retryAfter;
      }
      setError(null);
      setData(json);

      const found = json.stores.flatMap((store) =>
        s.excludedStores.includes(store.storeNumber)
          ? []
          : store.parts
              .filter((p) => p.status === "available")
              .map((p) => ({ store, part: p, key: `${store.storeNumber}|${p.partNumber}` })),
      );
      const fresh = found.filter((f) => !alertedRef.current.has(f.key));
      alertedRef.current = new Set(found.map((f) => f.key));

      if (fresh.length) {
        const first = fresh[0];
        const title = `${label(first.part.partNumber, first.part.title)} disponible !`;
        const body =
          fresh.length === 1
            ? `Apple ${first.store.name} — ${first.part.quote}`
            : `${fresh.length} disponibilités : ${[...new Set(fresh.map((f) => f.store.name))].join(", ")}`;
        showNotification(title, body, first.store.url);
        if (s.sound) playChime();
        sendNtfy(s.ntfyTopic.trim(), title, body, first.store.url).catch(() => {});
        pushLog({ kind: "alert", text: `${title} ${body}` });
      } else {
        pushLog({
          kind: "ok",
          text: found.length
            ? `${found.length} disponibilité(s), déjà signalée(s).`
            : `${json.stores.length} magasins vérifiés — rien de nouveau.`,
        });
      }
    } catch {
      const msg = "Connexion au serveur impossible.";
      setError(msg);
      pushLog({ kind: "error", text: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    const loop = async () => {
      const retryAfter = await check();
      if (cancelled) return;
      const delay = Math.max(latest.current.settings.intervalMin * 60, retryAfter ?? 0) * 1000;
      const jitter = Math.random() * 5000;
      setNextAt(Date.now() + delay + jitter);
      timerRef.current = setTimeout(loop, delay + jitter);
    };
    loop();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      setNextAt(null);
    };
  }, [watching, check]);

  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [watching]);

  const availableCount = useMemo(
    () =>
      data?.stores.reduce(
        (n, st) =>
          settings.excludedStores.includes(st.storeNumber)
            ? n
            : n + st.parts.filter((p) => p.status === "available").length,
        0,
      ) ?? 0,
    [data, settings.excludedStores],
  );

  useEffect(() => {
    document.title = availableCount
      ? `(${availableCount}) En stock ! — iPhone Duo`
      : "Stock iPhone Duo en Apple Store";
  }, [availableCount]);

  const resetResults = () => {
    setData(null);
    alertedRef.current = new Set();
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    resetResults();
    check();
  };

  const enableNotifications = async () => setPermission(await requestNotifications());

  const secondsLeft = nextAt ? Math.max(0, Math.round((nextAt - now) / 1000)) : null;

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <form
            onSubmit={onSearch}
            className="space-y-6 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur"
          >
            <Section title="Pays">
              <select
                value={settings.country}
                onChange={(e) => {
                  resetResults();
                  const c = getCountry(e.target.value)!;
                  update({
                    country: c.code,
                    location: c.defaultLocation,
                    excludedStores: [],
                    modelId: MODELS.find((m) => m.id === settings.modelId)?.variantsByCountry[c.code]
                      ? settings.modelId
                      : "iphone-duo",
                  });
                }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-400/60"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.label}
                  </option>
                ))}
              </select>
            </Section>

            <Section title="Modèle">
              <div className="flex flex-wrap gap-2">
                {MODELS.map((m) => (
                  <Chip
                    key={m.id}
                    active={m.id === model.id}
                    disabled={!m.variantsByCountry[country.code]}
                    onClick={() => {
                      resetResults();
                      update({ modelId: m.id });
                    }}
                  >
                    {m.name}
                  </Chip>
                ))}
              </div>
              {model.reference && (
                <p className="mt-2 text-xs text-zinc-500">
                  Modèle déjà en stock, pratique pour tester les notifications.
                </p>
              )}
            </Section>

            {!model.reference && (
              <>
                <Section title="Couleur">
                  <div className="flex flex-wrap gap-2">
                    {model.colors.map((c) => (
                      <Chip
                        key={c.id}
                        active={settings.colors.includes(c.id)}
                        onClick={() => update({ colors: toggle(settings.colors, c.id) })}
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-full ring-1 ring-white/20"
                          style={{ background: c.hex }}
                        />
                        {c.label}
                      </Chip>
                    ))}
                  </div>
                </Section>

                <Section title="Capacité">
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(STORAGE_LABELS) as Storage[]).map((st) => {
                      const price = countryVariants.find((v) => v.storage === st)?.price;
                      return (
                        <Chip
                          key={st}
                          active={settings.storages.includes(st)}
                          onClick={() => update({ storages: toggle(settings.storages, st) })}
                        >
                          <span className="flex w-full items-baseline justify-between gap-2">
                            {STORAGE_LABELS[st]}
                            {price && (
                              <span className="text-xs font-normal text-zinc-500">
                                {priceFormat.format(price)}
                              </span>
                            )}
                          </span>
                        </Chip>
                      );
                    })}
                  </div>
                  {tooMany && (
                    <p className="mt-2 text-xs text-amber-300">
                      {MAX_VARIANTS} configurations maximum par recherche : seules les{" "}
                      {MAX_VARIANTS} premières sont suivies.
                    </p>
                  )}
                </Section>
              </>
            )}

            <Section title="Code postal ou ville">
              <div className="flex gap-2">
                <input
                  value={settings.location}
                  onChange={(e) => update({ location: e.target.value })}
                  placeholder={country.locationPlaceholder}
                  className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-sky-400/60"
                />
                <button
                  type="submit"
                  disabled={loading || !selectedVariants.length || !settings.location.trim()}
                  className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-40"
                >
                  {loading ? "…" : "Vérifier"}
                </button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                Apple renvoie les 12 magasins les plus proches au maximum.
              </p>
            </Section>
          </form>

          <div className="space-y-5 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Surveillance</h2>
                <p className="text-sm text-zinc-400">
                  {watching
                    ? secondsLeft !== null && !loading
                      ? `Prochaine vérification dans ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
                      : "Vérification en cours…"
                    : "Laissez cet onglet ouvert pour être alerté."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWatching((w) => !w)}
                disabled={!selectedVariants.length || !settings.location.trim()}
                className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-40 ${
                  watching ? "bg-emerald-500" : "bg-zinc-700"
                }`}
                aria-pressed={watching}
                aria-label="Activer la surveillance"
              >
                <span
                  className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
                    watching ? "left-7" : "left-1"
                  }`}
                />
              </button>
            </div>

            <Section title="Fréquence">
              <div className="grid grid-cols-4 gap-2">
                {INTERVALS.map((m) => (
                  <Chip
                    key={m}
                    active={settings.intervalMin === m}
                    onClick={() => update({ intervalMin: m })}
                  >
                    <span className="w-full text-center">{m} min</span>
                  </Chip>
                ))}
              </div>
            </Section>

            <Section title="Notifications">
              <div className="space-y-2.5">
                {permission === "granted" ? (
                  <div className="flex items-center justify-between rounded-xl bg-emerald-400/10 px-3.5 py-2.5 text-sm text-emerald-300">
                    Notifications du navigateur activées
                    <button
                      type="button"
                      onClick={() =>
                        showNotification(
                          "Test de notification",
                          "Vous serez prévenu ainsi dès qu'un iPhone Duo est disponible.",
                        )
                      }
                      className="text-xs font-medium underline-offset-2 hover:underline"
                    >
                      Tester
                    </button>
                  </div>
                ) : permission === "unsupported" ? (
                  <p className="rounded-xl bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-400">
                    Ce navigateur ne gère pas les notifications.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={enableNotifications}
                    className="w-full rounded-xl border border-sky-400/40 bg-sky-400/10 px-3.5 py-2.5 text-sm font-medium text-sky-200 transition hover:bg-sky-400/20"
                  >
                    {permission === "denied"
                      ? "Notifications bloquées — autorisez-les dans le navigateur"
                      : "Activer les notifications"}
                  </button>
                )}
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
                  <input
                    type="checkbox"
                    checked={settings.sound}
                    onChange={(e) => update({ sound: e.target.checked })}
                    className="h-4 w-4 accent-sky-400"
                  />
                  Signal sonore
                </label>
                <div>
                  <input
                    value={settings.ntfyTopic}
                    onChange={(e) => update({ ntfyTopic: e.target.value.replace(/[^\w-]/g, "") })}
                    placeholder="Sujet ntfy (optionnel)"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-sky-400/60"
                  />
                  <p className="mt-1.5 text-xs text-zinc-500">
                    Push sur téléphone via l&apos;app gratuite{" "}
                    <a href="https://ntfy.sh" target="_blank" rel="noreferrer" className="text-sky-400">
                      ntfy
                    </a>
                    : abonnez-vous au même sujet.
                  </p>
                </div>
              </div>
            </Section>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${
                availableCount ? "bg-emerald-400/15 text-emerald-300" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {availableCount ? "✓" : "◎"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-white">
                {!data
                  ? "Aucune recherche pour l'instant"
                  : availableCount
                    ? `${availableCount} disponibilité(s) en retrait`
                    : "Pas encore disponible en retrait"}
              </p>
              <p className="truncate text-sm text-zinc-400">
                {data
                  ? `${data.stores.length} magasins autour de « ${data.location} » · mis à jour à ${new Date(data.fetchedAt).toLocaleTimeString("fr-FR")}${data.cached ? " (cache)" : ""}`
                  : `${selectedVariants.length} configuration(s) sélectionnée(s) · ${country.flag} ${country.label}`}
              </p>
            </div>
            {watching && (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Surveillance active
              </span>
            )}
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          {data ? (
            <div className="grid gap-4 md:grid-cols-2">
              {data.stores.map((store) => (
                <StoreCard
                  key={store.storeNumber}
                  store={store}
                  variantLabel={variantLabel}
                  watched={!settings.excludedStores.includes(store.storeNumber)}
                  onToggleWatch={() =>
                    update({ excludedStores: toggle(settings.excludedStores, store.storeNumber) })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className={`h-44 rounded-2xl border border-zinc-800/70 bg-zinc-900/30 ${loading ? "animate-pulse" : ""}`}
                />
              ))}
            </div>
          )}

          {log.length > 0 && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Historique
              </h2>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto text-sm">
                {log.map((entry, i) => (
                  <li key={i} className="flex gap-3">
                    <time className="shrink-0 tabular-nums text-zinc-500">
                      {entry.at.toLocaleTimeString("fr-FR")}
                    </time>
                    <span
                      className={
                        entry.kind === "alert"
                          ? "text-emerald-300"
                          : entry.kind === "error"
                            ? "text-rose-300"
                            : "text-zinc-400"
                      }
                    >
                      {entry.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs leading-relaxed text-zinc-600">
            Source : service public « retrait en magasin » d&apos;apple.com, interrogé par notre
            serveur (cache de 45 s, 20 requêtes/min max). Outil non officiel, sans lien avec
            Apple. La disponibilité réelle peut évoluer entre deux vérifications.
          </p>
        </section>
      </div>
    </Shell>
  );
}
