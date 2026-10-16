import {
  getCountry,
  getRegion,
  PART_NUMBER_RE,
  type Country,
  type Region,
} from "./catalog";
import { getRegionStock, getStock } from "./apple";

export const MAX_PARTS = 4;

export interface StockTarget {
  country: Country;
  parts: string[];
  region: Region | undefined;
  location: string;
}

export type TargetInput = {
  country?: unknown;
  parts?: unknown;
  region?: unknown;
  location?: unknown;
};

/** Validates a country / parts / region-or-location triple coming from a client. */
export function parseTarget(input: TargetInput): StockTarget | { error: string } {
  const country = getCountry(String(input.country ?? ""));
  if (!country) return { error: "Pays non pris en charge." };

  const regionId = input.region ? String(input.region) : "";
  const region = regionId ? getRegion(regionId) : undefined;
  if (regionId && (!region || region.country !== country.code)) {
    return { error: "Région non prise en charge pour ce pays." };
  }

  const location = String(input.location ?? "").trim();
  if (!region && (!location || location.length > 60)) {
    return { error: "Indiquez un code postal ou une ville." };
  }

  const rawParts = Array.isArray(input.parts) ? input.parts : String(input.parts ?? "").split(",");
  const parts = rawParts.map((p) => String(p).trim().toUpperCase()).filter(Boolean);
  if (!parts.length || parts.length > MAX_PARTS || !parts.every((p) => PART_NUMBER_RE.test(p))) {
    return { error: `Entre 1 et ${MAX_PARTS} références Apple valides (ex. MK2E4F/A).` };
  }

  return { country, parts, region, location: region ? "" : location };
}

export function fetchTarget(target: StockTarget) {
  return target.region
    ? getRegionStock(target.country, target.parts, target.region)
    : getStock(target.country, target.parts, target.location);
}
