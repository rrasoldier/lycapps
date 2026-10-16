import { emailEnabled, pushPublicKey } from "@/lib/apple-stock/alerts";
import { handleError, jsonError, readJson } from "@/lib/apple-stock/http";
import { getStore } from "@/lib/apple-stock/kv";
import { createWatch, parseWatchInput, toPublic } from "@/lib/apple-stock/watches";

/** What the server can do, so the UI only offers configured channels. */
export async function GET() {
  return Response.json(
    {
      storage: getStore()?.kind ?? null,
      pushPublicKey: pushPublicKey(),
      email: emailEnabled(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return jsonError("Corps JSON attendu.", 400);
  const fields = parseWatchInput(body);
  if ("error" in fields) return jsonError(fields.error, 400);
  try {
    const watch = await createWatch(fields);
    return Response.json(toPublic(watch), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
