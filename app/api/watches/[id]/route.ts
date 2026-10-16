import type { NextRequest } from "next/server";
import { handleError, jsonError, readJson } from "@/lib/apple-stock/http";
import { deleteWatch, getWatch, parseWatchInput, saveWatch, toPublic } from "@/lib/apple-stock/watches";

// The watch id is an unguessable UUID and acts as the capability to read or change it.

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/watches/[id]">) {
  const { id } = await ctx.params;
  try {
    const watch = await getWatch(id);
    if (!watch) return jsonError("Surveillance introuvable.", 404);
    return Response.json(toPublic(watch), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/watches/[id]">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return jsonError("Corps JSON attendu.", 400);
  try {
    const watch = await getWatch(id);
    if (!watch) return jsonError("Surveillance introuvable.", 404);
    const fields = parseWatchInput({ ...watch, ...body });
    if ("error" in fields) return jsonError(fields.error, 400);
    const targetChanged =
      fields.country !== watch.country ||
      fields.region !== watch.region ||
      fields.location !== watch.location ||
      fields.parts.join() !== watch.parts.join();
    const updated = {
      ...watch,
      ...fields,
      available: targetChanged ? [] : watch.available,
      updatedAt: new Date().toISOString(),
    };
    await saveWatch(updated);
    return Response.json(toPublic(updated));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/watches/[id]">) {
  const { id } = await ctx.params;
  try {
    await deleteWatch(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleError(err);
  }
}
