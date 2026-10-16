"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicWatch } from "@/lib/apple-stock/watches";

const WATCH_ID_KEY = "apple-stock-tracker:watch-id";

export interface WatchTarget {
  country: string;
  parts: string[];
  region: string | null;
  location: string;
  excludedStores: string[];
  labels: Record<string, string>;
  ntfyTopic: string;
}

interface ServerConfig {
  storage: "redis" | "file" | null;
  pushPublicKey: string | null;
  email: boolean;
}

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribePush(publicKey: string): Promise<PushSubscriptionJSON | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  if ((await Notification.requestPermission()) !== "granted") return null;
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  return sub.toJSON();
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status });
  return json as T;
}

function time(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
    : "—";
}

export default function BackgroundAlerts({
  target,
  onActiveChange,
}: {
  target: WatchTarget;
  onActiveChange: (active: boolean) => void;
}) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [watchId, setWatchId] = useState<string | null>(() => localStorage.getItem(WATCH_ID_KEY));
  const [watch, setWatch] = useState<PublicWatch | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const targetKey = JSON.stringify(target);
  const syncedKey = useRef(targetKey);

  useEffect(() => {
    api<ServerConfig>("/api/watches").then(setConfig, () => setConfig(null));
  }, []);

  useEffect(() => {
    onActiveChange(Boolean(watchId));
  }, [watchId, onActiveChange]);

  const forget = useCallback(() => {
    localStorage.removeItem(WATCH_ID_KEY);
    setWatchId(null);
    setWatch(null);
  }, []);

  useEffect(() => {
    if (!watchId) return;
    const load = () =>
      api<PublicWatch>(`/api/watches/${watchId}`).then(setWatch, (err) => {
        if (err.status === 404) forget();
      });
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [watchId, forget]);

  useEffect(() => {
    if (!watchId || syncedKey.current === targetKey) return;
    const t = setTimeout(() => {
      api<PublicWatch>(`/api/watches/${watchId}`, { method: "PUT", body: targetKey }).then(
        (w) => {
          syncedKey.current = targetKey;
          setWatch(w);
        },
        (err) => setMessage({ kind: "error", text: err.message }),
      );
    }, 800);
    return () => clearTimeout(t);
  }, [watchId, targetKey]);

  const enable = async () => {
    if (!config) return;
    setBusy(true);
    setMessage(null);
    try {
      const push = config.pushPublicKey ? await subscribePush(config.pushPublicKey) : null;
      if (!push && !target.ntfyTopic && !email) {
        throw new Error(
          "Autorisez les notifications, ou renseignez un sujet ntfy / un e-mail pour être alerté.",
        );
      }
      const w = await api<PublicWatch>("/api/watches", {
        method: "POST",
        body: JSON.stringify({ ...target, push, email }),
      });
      localStorage.setItem(WATCH_ID_KEY, w.id);
      syncedKey.current = targetKey;
      setWatchId(w.id);
      setWatch(w);
      setMessage({ kind: "ok", text: "C'est parti : vous pouvez fermer cet onglet." });
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!watchId) return;
    setBusy(true);
    try {
      await api(`/api/watches/${watchId}`, { method: "DELETE" });
      forget();
      setMessage(null);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!watchId) return;
    const r = await api<Record<string, string>>(`/api/watches/${watchId}/test`, { method: "POST" });
    const sent = Object.entries(r).filter(([, v]) => v === "sent").map(([k]) => k);
    setMessage(
      sent.length
        ? { kind: "ok", text: `Test envoyé (${sent.join(", ")}).` }
        : { kind: "error", text: "Aucun canal n'a pu être joint." },
    );
  };

  const unavailable = config && !config.storage;

  return (
    <div className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Alertes navigateur fermé</h2>
          <p className="text-sm text-zinc-400">
            Notre serveur vérifie toutes les 5 minutes et vous envoie une notification push.
          </p>
        </div>
        {watchId && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Actif
          </span>
        )}
      </div>

      {unavailable ? (
        <p className="rounded-xl bg-zinc-800/60 px-3.5 py-2.5 text-sm text-zinc-400">
          Indisponible : le stockage serveur n&apos;est pas encore configuré.
        </p>
      ) : watchId ? (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-zinc-950/60 p-3.5 text-sm">
            <dt className="text-zinc-500">Dernière vérif.</dt>
            <dd className="text-right text-zinc-200">{time(watch?.lastCheckedAt ?? null)}</dd>
            <dt className="text-zinc-500">En stock</dt>
            <dd className="text-right text-zinc-200">{watch?.available.length ?? 0}</dd>
            <dt className="text-zinc-500">Canaux</dt>
            <dd className="text-right text-zinc-200">
              {[watch?.hasPush && "push", watch?.ntfyTopic && "ntfy", watch?.hasEmail && "e-mail"]
                .filter(Boolean)
                .join(" · ") || "—"}
            </dd>
          </dl>
          {watch?.lastAlert && (
            <p className="text-xs text-emerald-300">
              {time(watch.lastAlertAt)} — {watch.lastAlert}
            </p>
          )}
          {watch?.lastError && <p className="text-xs text-rose-300">{watch.lastError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={test}
              className="flex-1 rounded-xl border border-zinc-700 px-3.5 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500"
            >
              Envoyer un test
            </button>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className="flex-1 rounded-xl border border-rose-500/30 px-3.5 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-40"
            >
              Désactiver
            </button>
          </div>
        </>
      ) : (
        <>
          {config?.email && (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-mail (optionnel)"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-sky-400/60"
            />
          )}
          <button
            type="button"
            onClick={enable}
            disabled={busy || !config || !target.parts.length}
            className="w-full rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-40"
          >
            {busy ? "Activation…" : "Activer les alertes en arrière-plan"}
          </button>
        </>
      )}

      {message && (
        <p className={`text-xs ${message.kind === "ok" ? "text-emerald-300" : "text-rose-300"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
