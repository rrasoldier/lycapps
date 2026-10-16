import { StoreNotConfiguredError } from "./kv";

export function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function handleError(err: unknown) {
  if (err instanceof StoreNotConfiguredError) return jsonError(err.message, 503);
  return jsonError(err instanceof Error ? err.message : "Erreur serveur.", 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}
