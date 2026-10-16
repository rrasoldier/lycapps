import { handleError, jsonError } from "@/lib/apple-stock/http";
import { checkAllWatches } from "@/lib/apple-stock/watches";

export const maxDuration = 60;

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically; the
// GitHub Actions workflow sends the same header.
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return jsonError("Non autorisé.", 401);
  try {
    const started = Date.now();
    const results = await checkAllWatches();
    return Response.json({
      checked: results.length,
      failed: results.filter((r) => !r.ok).length,
      alerted: results.reduce((n, r) => n + r.alerted, 0),
      durationMs: Date.now() - started,
      results,
    });
  } catch (err) {
    return handleError(err);
  }
}
