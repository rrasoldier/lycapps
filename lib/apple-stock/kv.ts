import { promises as fs } from "node:fs";
import path from "node:path";

/** Minimal hash-map storage: Upstash Redis (REST) in production, a JSON file locally. */
export interface HashStore {
  readonly kind: "redis" | "file";
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
}

export class StoreNotConfiguredError extends Error {
  constructor() {
    super(
      "Stockage non configuré : ajoutez une base Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN).",
    );
  }
}

function redisStore(url: string, token: string): HashStore {
  async function command<T>(...args: string[]): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    const json = (await res.json()) as { result?: T; error?: string };
    if (!res.ok || json.error) throw new Error(`Redis: ${json.error ?? res.status}`);
    return json.result as T;
  }
  return {
    kind: "redis",
    hget: (key, field) => command<string | null>("HGET", key, field),
    hset: async (key, field, value) => void (await command("HSET", key, field, value)),
    hdel: async (key, field) => void (await command("HDEL", key, field)),
    hgetall: async (key) => {
      const flat = await command<string[]>("HGETALL", key);
      const out: Record<string, string> = {};
      for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
      return out;
    },
  };
}

function fileStore(file: string): HashStore {
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<Record<string, Record<string, string>>> => {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return {};
    }
  };
  const mutate = (fn: (db: Record<string, Record<string, string>>) => void) => {
    const run = queue.then(async () => {
      const db = await read();
      fn(db);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(db, null, 2));
    });
    queue = run.catch(() => {});
    return run;
  };
  return {
    kind: "file",
    hget: async (key, field) => (await read())[key]?.[field] ?? null,
    hset: (key, field, value) => mutate((db) => void ((db[key] ??= {})[field] = value)),
    hdel: (key, field) => mutate((db) => void delete db[key]?.[field]),
    hgetall: async (key) => (await read())[key] ?? {},
  };
}

let store: HashStore | null | undefined;

/** Returns null when nothing is configured on a serverless deploy (read-only filesystem). */
export function getStore(): HashStore | null {
  if (store !== undefined) return store;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) store = redisStore(url, token);
  else if (process.env.VERCEL) store = null;
  else store = fileStore(process.env.STOCK_DATA_FILE ?? path.join(process.cwd(), ".data", "stock-watches.json"));
  return store;
}

export function requireStore(): HashStore {
  const s = getStore();
  if (!s) throw new StoreNotConfiguredError();
  return s;
}
