import type { NextRequest } from "next/server";
import { getCountry, PART_NUMBER_RE } from "@/lib/apple-stock/catalog";
import { getStock, UpstreamError } from "@/lib/apple-stock/apple";
import type { StockError } from "@/lib/apple-stock/types";

const MAX_PARTS = 4;

function fail(error: string, status: number, retryAfter?: number) {
  const body: StockError = { error, retryAfter };
  return Response.json(body, {
    status,
    headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const country = getCountry(params.get("country") ?? "");
  if (!country) return fail("Pays non pris en charge.", 400);

  const location = (params.get("location") ?? "").trim();
  if (!location || location.length > 60) {
    return fail("Indiquez un code postal ou une ville.", 400);
  }

  const parts = (params.get("parts") ?? "")
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  if (!parts.length || parts.length > MAX_PARTS || !parts.every((p) => PART_NUMBER_RE.test(p))) {
    return fail(`Entre 1 et ${MAX_PARTS} références Apple valides (ex. MK2E4F/A).`, 400);
  }

  try {
    const data = await getStock(country, parts, location);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UpstreamError) return fail(err.message, err.status, err.retryAfter);
    return fail("Impossible de joindre apple.com pour le moment.", 502);
  }
}
