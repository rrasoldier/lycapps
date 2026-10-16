import type { PushSubscription } from "web-push";
import { sendAlert, type AlertResult } from "./alerts";
import { requireStore } from "./kv";
import { fetchTarget, parseTarget, type StockTarget } from "./target";

const WATCHES_KEY = "apple-stock:watches";
export const MAX_WATCHES = 200;

export interface Watch {
  id: string;
  createdAt: string;
  updatedAt: string;
  country: string;
  parts: string[];
  region: string | null;
  location: string;
  excludedStores: string[];
  /** Human labels per part number, shown in alerts. */
  labels: Record<string, string>;
  push: PushSubscription | null;
  ntfyTopic: string;
  email: string;
  /** "<storeNumber>|<partNumber>" pairs available at the last successful check. */
  available: string[];
  lastCheckedAt: string | null;
  lastError: string | null;
  lastAlertAt: string | null;
  lastAlert: string | null;
}

export type PublicWatch = Omit<Watch, "push" | "email"> & { hasPush: boolean; hasEmail: boolean };

export function toPublic(w: Watch): PublicWatch {
  const { push, email, ...rest } = w;
  return { ...rest, hasPush: Boolean(push), hasEmail: Boolean(email) };
}

export interface WatchInput {
  country?: unknown;
  parts?: unknown;
  region?: unknown;
  location?: unknown;
  excludedStores?: unknown;
  labels?: unknown;
  push?: unknown;
  ntfyTopic?: unknown;
  email?: unknown;
}

function isPushSubscription(v: unknown): v is PushSubscription {
  const s = v as PushSubscription;
  return (
    typeof s?.endpoint === "string" &&
    /^https:\/\//.test(s.endpoint) &&
    typeof s.keys?.p256dh === "string" &&
    typeof s.keys?.auth === "string"
  );
}

/** Validates client input and returns the fields a watch stores. */
export function parseWatchInput(input: WatchInput) {
  const target = parseTarget(input);
  if ("error" in target) return target;

  const excludedStores = Array.isArray(input.excludedStores)
    ? input.excludedStores.map(String).filter((s) => /^R\d{3,4}$/.test(s)).slice(0, 50)
    : [];
  const labels: Record<string, string> = {};
  if (input.labels && typeof input.labels === "object") {
    for (const part of target.parts) {
      const label = (input.labels as Record<string, unknown>)[part];
      if (typeof label === "string") labels[part] = label.slice(0, 80);
    }
  }
  const push = input.push == null ? null : isPushSubscription(input.push) ? input.push : undefined;
  if (push === undefined) return { error: "Abonnement push invalide." };
  const ntfyTopic = String(input.ntfyTopic ?? "").replace(/[^\w-]/g, "").slice(0, 64);
  const email = String(input.email ?? "").trim().slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Adresse e-mail invalide." };
  if (!push && !ntfyTopic && !email) {
    return { error: "Activez au moins un canal : push navigateur, ntfy ou e-mail." };
  }

  return {
    country: target.country.code,
    parts: target.parts,
    region: target.region?.id ?? null,
    location: target.location,
    excludedStores,
    labels,
    push,
    ntfyTopic,
    email,
  };
}

export async function listWatches(): Promise<Watch[]> {
  const all = await requireStore().hgetall(WATCHES_KEY);
  return Object.values(all).map((v) => JSON.parse(v) as Watch);
}

export async function getWatch(id: string): Promise<Watch | null> {
  if (!/^[\w-]{20,60}$/.test(id)) return null;
  const raw = await requireStore().hget(WATCHES_KEY, id);
  return raw ? (JSON.parse(raw) as Watch) : null;
}

export async function saveWatch(w: Watch) {
  await requireStore().hset(WATCHES_KEY, w.id, JSON.stringify(w));
}

export async function deleteWatch(id: string) {
  await requireStore().hdel(WATCHES_KEY, id);
}

export async function createWatch(fields: Exclude<ReturnType<typeof parseWatchInput>, { error: string }>) {
  const count = Object.keys(await requireStore().hgetall(WATCHES_KEY)).length;
  if (count >= MAX_WATCHES) throw new Error("Nombre maximal de surveillances atteint.");
  const now = new Date().toISOString();
  const watch: Watch = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...fields,
    available: [],
    lastCheckedAt: null,
    lastError: null,
    lastAlertAt: null,
    lastAlert: null,
  };
  await saveWatch(watch);
  return watch;
}

function targetOf(w: Watch): StockTarget {
  const t = parseTarget(w);
  if ("error" in t) throw new Error(t.error);
  return t;
}

export interface CheckResult {
  id: string;
  ok: boolean;
  available: number;
  alerted: number;
  channels?: AlertResult;
  error?: string;
}

/**
 * Checks one watch and alerts only for store/part pairs that were not available
 * at the previous successful check, so each transition to "available" notifies once.
 */
export async function checkWatch(w: Watch): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const stock = await fetchTarget(targetOf(w));
    const found = stock.stores.flatMap((store) =>
      w.excludedStores.includes(store.storeNumber)
        ? []
        : store.parts
            .filter((p) => p.status === "available")
            .map((part) => ({ store, part, key: `${store.storeNumber}|${part.partNumber}` })),
    );
    const previous = new Set(w.available);
    const fresh = found.filter((f) => !previous.has(f.key));

    let channels: AlertResult | undefined;
    if (fresh.length) {
      const first = fresh[0];
      const label = w.labels[first.part.partNumber] || first.part.title;
      const stores = [...new Set(fresh.map((f) => `Apple ${f.store.name}`))];
      const msg = {
        title: `${label} disponible !`,
        body:
          stores.length === 1
            ? `${stores[0]} — ${first.part.quote}`
            : `${fresh.length} nouvelles disponibilités : ${stores.join(", ")}`,
        url: first.store.url,
        tag: `stock-${w.id}`,
      };
      channels = await sendAlert(w, msg);
      if (channels.push === "expired") w.push = null;
      w.lastAlertAt = now;
      w.lastAlert = `${msg.title} ${msg.body}`;
    }

    w.available = found.map((f) => f.key);
    w.lastCheckedAt = now;
    w.lastError = null;
    await saveWatch(w);
    return { id: w.id, ok: true, available: found.length, alerted: fresh.length, channels };
  } catch (err) {
    // Keep `available` untouched so a transient failure never re-triggers alerts.
    w.lastCheckedAt = now;
    w.lastError = err instanceof Error ? err.message : String(err);
    await saveWatch(w);
    return { id: w.id, ok: false, available: 0, alerted: 0, error: w.lastError };
  }
}

export async function checkAllWatches() {
  const watches = await listWatches();
  const results: CheckResult[] = [];
  // Sequential on purpose: identical targets hit the 45 s cache and the
  // upstream rate limiter stays meaningful.
  for (const w of watches) results.push(await checkWatch(w));
  return results;
}
