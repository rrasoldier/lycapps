import type { NextRequest } from "next/server";
import { UpstreamError } from "@/lib/apple-stock/apple";
import { fetchTarget, parseTarget } from "@/lib/apple-stock/target";
import type { StockError } from "@/lib/apple-stock/types";

function fail(error: string, status: number, retryAfter?: number) {
  const body: StockError = { error, retryAfter };
  return Response.json(body, {
    status,
    headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = parseTarget({
    country: params.get("country"),
    parts: params.get("parts"),
    region: params.get("region"),
    location: params.get("location"),
  });
  if ("error" in target) return fail(target.error, 400);

  try {
    const data = await fetchTarget(target);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UpstreamError) return fail(err.message, err.status, err.retryAfter);
    return fail("Impossible de joindre apple.com pour le moment.", 502);
  }
}
