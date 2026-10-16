import type { Country, Region } from "./catalog";
import type {
  AvailabilityStatus,
  PartAvailability,
  StockResponse,
  StoreAvailability,
} from "./types";

const CACHE_TTL_MS = 45_000;
const MAX_UPSTREAM_PER_MINUTE = 20;
const BLOCKED_BACKOFF_MS = 5 * 60_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

interface CacheEntry {
  at: number;
  data: Omit<StockResponse, "cached" | "nextRefreshIn">;
}

// Module-level state is per server instance, which is enough to keep a single
// deployment polite towards apple.com.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();
const upstreamCalls: number[] = [];
let blockedUntil = 0;

interface RawPart {
  partNumber: string;
  pickupDisplay?: string;
  storePickEligible?: boolean;
  pickupSearchQuote?: string;
  messageTypes?: {
    regular?: { storePickupProductTitle?: string; storePickupQuote?: string };
  };
}

interface RawStore {
  storeNumber: string;
  storeName: string;
  city: string;
  storeDistanceWithUnit?: string;
  reservationUrl?: string;
  storeImageUrl?: string;
  phoneNumber?: string;
  storelatitude?: number;
  storelongitude?: number;
  address?: { address?: string; address2?: string; postalCode?: string };
  partsAvailability?: Record<string, RawPart>;
}

function stripHtml(value: string | undefined) {
  return (value ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function classify(part: RawPart): AvailabilityStatus {
  if (part.pickupDisplay === "available") return "available";
  // "default" is what Apple returns before launch / during pre-orders
  // ("Revenez vérifier la disponibilité le 24/10").
  if (part.pickupDisplay === "default") return "not-yet";
  return "unavailable";
}

function normalizeStore(raw: RawStore): StoreAvailability {
  const parts: PartAvailability[] = Object.values(raw.partsAvailability ?? {}).map(
    (p) => ({
      partNumber: p.partNumber,
      title: stripHtml(p.messageTypes?.regular?.storePickupProductTitle) || p.partNumber,
      status: classify(p),
      quote: stripHtml(p.pickupSearchQuote || p.messageTypes?.regular?.storePickupQuote),
    }),
  );
  const addr = raw.address ?? {};
  return {
    storeNumber: raw.storeNumber,
    name: raw.storeName,
    city: raw.city,
    address: [addr.address2, addr.postalCode].filter(Boolean).join(", "),
    postalCode: addr.postalCode ?? "",
    distance: raw.storeDistanceWithUnit ?? "",
    url: (raw.reservationUrl ?? "").replace(/^http:/, "https:"),
    imageUrl: (raw.storeImageUrl ?? "").replace(/^http:/, "https:"),
    phone: raw.phoneNumber ?? "",
    latitude: raw.storelatitude ?? 0,
    longitude: raw.storelongitude ?? 0,
    parts,
  };
}

function takeUpstreamSlot() {
  const now = Date.now();
  if (now < blockedUntil) {
    throw new UpstreamError(
      "Apple limite temporairement les requêtes. Nouvelle tentative plus tard.",
      429,
      Math.ceil((blockedUntil - now) / 1000),
    );
  }
  while (upstreamCalls.length && now - upstreamCalls[0] > 60_000) upstreamCalls.shift();
  if (upstreamCalls.length >= MAX_UPSTREAM_PER_MINUTE) {
    throw new UpstreamError(
      "Trop de requêtes vers Apple, merci de patienter.",
      429,
      Math.ceil((60_000 - (now - upstreamCalls[0])) / 1000),
    );
  }
  upstreamCalls.push(now);
}

async function queryApple(
  country: Country,
  parts: string[],
  location: string,
): Promise<CacheEntry> {
  takeUpstreamSlot();

  const url = new URL(`https://www.apple.com/${country.path}shop/retail/pickup-message`);
  url.searchParams.set("pl", "true");
  parts.forEach((p, i) => url.searchParams.set(`parts.${i}`, p));
  url.searchParams.set("location", location);

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Accept-Language": `${country.locale},${country.locale.split("-")[0]};q=0.9`,
      Referer: `https://www.apple.com/${country.path}shop/buy-iphone`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  if (res.status === 429 || res.status === 403 || res.status === 503 || res.status === 541) {
    blockedUntil = Date.now() + BLOCKED_BACKOFF_MS;
    throw new UpstreamError(
      `Apple a refusé la requête (HTTP ${res.status}). Pause de 5 minutes.`,
      429,
      BLOCKED_BACKOFF_MS / 1000,
    );
  }
  if (!res.ok) {
    throw new UpstreamError(`Réponse inattendue d'Apple (HTTP ${res.status}).`, 502);
  }

  const json = (await res.json()) as {
    body?: { stores?: RawStore[]; errorMessage?: string };
  };
  const stores = json.body?.stores;
  if (!stores) {
    throw new UpstreamError(
      json.body?.errorMessage || "Aucun Apple Store trouvé pour cette localisation.",
      404,
    );
  }

  return {
    at: Date.now(),
    data: {
      country: country.code,
      location,
      fetchedAt: new Date().toISOString(),
      stores: stores.map(normalizeStore),
    },
  };
}

export async function getStock(
  country: Country,
  parts: string[],
  location: string,
): Promise<StockResponse> {
  const key = `${country.code}|${location.toLowerCase()}|${[...parts].sort().join(",")}`;
  const hit = cache.get(key);
  const now = Date.now();

  if (hit && now - hit.at < CACHE_TTL_MS) {
    return {
      ...hit.data,
      cached: true,
      nextRefreshIn: Math.ceil((CACHE_TTL_MS - (now - hit.at)) / 1000),
    };
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = queryApple(country, parts, location).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  const entry = await pending;
  cache.set(key, entry);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);

  return { ...entry.data, cached: false, nextRefreshIn: CACHE_TTL_MS / 1000 };
}

function kmBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Apple returns at most ~12 stores around one location, so a region is covered
 * by querying its locations in order until every expected store has been seen.
 * Each query goes through getStock and therefore shares its cache and rate limit.
 */
export async function getRegionStock(
  country: Country,
  parts: string[],
  region: Region,
): Promise<StockResponse> {
  const stores = new Map<string, StoreAvailability>();
  let cached = true;
  let nextRefreshIn = Infinity;
  let fetchedAt = "";

  for (const location of region.locations) {
    const res = await getStock(country, parts, location);
    cached &&= res.cached;
    nextRefreshIn = Math.min(nextRefreshIn, res.nextRefreshIn);
    if (!fetchedAt || res.fetchedAt < fetchedAt) fetchedAt = res.fetchedAt;
    for (const store of res.stores) {
      if (!stores.has(store.storeNumber)) stores.set(store.storeNumber, store);
    }
    if (region.storeNumbers.every((n) => stores.has(n))) break;
  }

  const inRegion = [...stores.values()]
    .filter((s) => region.postalPrefixes.some((p) => s.postalCode.startsWith(p)))
    .map((s) => ({ store: s, km: kmBetween(region.center, s) }))
    .sort((a, b) => a.km - b.km)
    .map(({ store, km }) => ({
      ...store,
      distance: `${km.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`,
    }));

  return {
    country: country.code,
    location: region.label,
    fetchedAt,
    cached,
    nextRefreshIn,
    stores: inRegion,
    missingStores: region.storeNumbers.filter((n) => !stores.has(n)),
  };
}
