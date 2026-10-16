import type { NextRequest } from "next/server";
import { sendAlert } from "@/lib/apple-stock/alerts";
import { handleError, jsonError } from "@/lib/apple-stock/http";
import { getWatch, saveWatch } from "@/lib/apple-stock/watches";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/watches/[id]/test">) {
  const { id } = await ctx.params;
  try {
    const watch = await getWatch(id);
    if (!watch) return jsonError("Surveillance introuvable.", 404);
    const result = await sendAlert(watch, {
      title: "Test d'alerte iPhone Duo",
      body: "Les alertes en arrière-plan fonctionnent, même onglet fermé.",
      url: "/stock-iphone",
      tag: `test-${watch.id}`,
    });
    if (result.push === "expired") {
      watch.push = null;
      await saveWatch(watch);
    }
    return Response.json(result);
  } catch (err) {
    return handleError(err);
  }
}
