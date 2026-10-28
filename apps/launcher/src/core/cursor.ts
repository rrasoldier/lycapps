import * as os from "node:os";
import { systemPrompt } from "./agent";
import { TOOL_SCHEMAS, runTool, type ToolContext } from "./tools";
import type { AgentEvent, ChatMessage, LlmClient } from "./types";

/**
 * Fournisseur « Cursor » : utilise le SDK officiel `@cursor/sdk` (runtime local) avec la clé
 * CURSOR_API_KEY. Ce n'est PAS une API de chat-completions : le SDK exécute la boucle d'agent
 * Cursor ; l'inférence reste hébergée par Cursor. On désactive tous ses outils intégrés
 * (`tools: ["mcp"]`) et on lui expose uniquement NOS outils (`local.customTools`), qui passent
 * par le même périmètre et les mêmes confirmations que les autres fournisseurs.
 */

export const CURSOR_DEFAULT_MODEL = "composer-2.5";
export const CURSOR_MIN_NODE = [22, 13] as const;

export interface CursorModelInfo {
  id: string;
  displayName: string;
  description?: string;
}

export interface CursorCustomTool {
  description?: string;
  inputSchema?: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;
}

export interface CursorRunLike {
  /** Événements en direct (texte intermédiaire, réflexion…). Optionnel. */
  stream?(): AsyncIterable<unknown>;
  wait(): Promise<{ status: "finished" | "error" | "cancelled"; result?: string; error?: { message: string; code?: string } }>;
  cancel(): Promise<void>;
}

export interface CursorAgentLike {
  send(prompt: string): Promise<CursorRunLike>;
  close?(): void | Promise<void>;
}

export interface CursorAgentOptions {
  apiKey: string;
  model: { id: string };
  tools?: string[];
  local: { cwd: string; customTools?: Record<string, CursorCustomTool> };
}

/** Sous-ensemble du SDK dont on dépend (permet de le simuler dans les tests). */
export interface CursorSdkLike {
  Agent: { create(options: CursorAgentOptions): Promise<CursorAgentLike> };
  Cursor: { models: { list(options?: { apiKey?: string }): Promise<CursorModelInfo[]> } };
}

export function nodeSupportsCursorSdk(version = process.versions.node): boolean {
  const [major, minor] = version.split(".").map(Number);
  return major > CURSOR_MIN_NODE[0] || (major === CURSOR_MIN_NODE[0] && minor >= CURSOR_MIN_NODE[1]);
}

export async function loadCursorSdk(): Promise<CursorSdkLike> {
  if (!nodeSupportsCursorSdk()) {
    throw new Error(`Le SDK Cursor requiert Node ${CURSOR_MIN_NODE.join(".")}+ (ici ${process.versions.node}). Utilisez Electron 35 ou plus récent.`);
  }
  const specifier = "@cursor/sdk";
  try {
    return (await import(specifier)) as unknown as CursorSdkLike;
  } catch (e) {
    throw new Error(`Impossible de charger @cursor/sdk : ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function toCustomTools(ctx: ToolContext, onEvent: (e: AgentEvent) => void): Record<string, CursorCustomTool> {
  const tools: Record<string, CursorCustomTool> = {};
  for (const schema of TOOL_SCHEMAS) {
    const { name, description, parameters } = schema.function;
    tools[name] = {
      description,
      inputSchema: parameters,
      async execute(args) {
        onEvent({ type: "tool_call", name, args });
        const r = await runTool(name, args, ctx);
        onEvent({ type: "tool_result", name, ok: r.ok, output: r.output });
        return { content: [{ type: "text", text: `${r.ok ? "OK" : "ERREUR"}: ${r.output}` }], isError: !r.ok };
      },
    };
  }
  return tools;
}

/** Transforme le flux d'événements du SDK en messages de progression ; ne lève jamais. */
export async function forwardStream(run: CursorRunLike, emit: (e: AgentEvent) => void): Promise<void> {
  if (!run.stream) return;
  let thinking = false;
  try {
    for await (const ev of run.stream() as AsyncIterable<{ type?: string; message?: { content?: Array<{ type: string; text?: string }> } }>) {
      if (ev.type === "thinking") {
        if (!thinking) emit({ type: "progress", text: "Réflexion…" });
        thinking = true;
      } else if (ev.type === "assistant") {
        thinking = false;
        const text = (ev.message?.content ?? [])
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text)
          .join("")
          .trim();
        if (text) emit({ type: "progress", text });
      }
    }
  } catch {
    /* le flux est purement informatif : wait() reste la source de vérité */
  }
}

async function waitWithProgress(run: CursorRunLike, emit: (e: AgentEvent) => void) {
  const streaming = forwardStream(run, emit);
  try {
    return await run.wait();
  } finally {
    await Promise.race([streaming, new Promise((r) => setTimeout(r, 300))]);
  }
}

async function closeQuietly(agent: CursorAgentLike): Promise<void> {
  try {
    await agent.close?.();
  } catch {
    /* sans importance */
  }
}

export interface RunCursorAgentOptions {
  sdk: CursorSdkLike;
  apiKey: string;
  model: string;
  ctx: ToolContext;
  prompt: string;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

export async function runCursorAgent(opts: RunCursorAgentOptions): Promise<string> {
  const emit = opts.onEvent ?? (() => {});
  if (opts.signal?.aborted) throw new Error("Annulé.");
  const agent = await opts.sdk.Agent.create({
    apiKey: opts.apiKey,
    model: { id: opts.model },
    // Aucun outil intégré (shell, édition…) : seuls nos outils MCP « custom » sont proposés.
    tools: ["mcp"],
    // Dossier de travail neutre : l'agent n'a pas d'outil fichier propre, tout passe par nos outils.
    local: { cwd: os.tmpdir(), customTools: toCustomTools(opts.ctx, emit) },
  });
  try {
    emit({ type: "progress", text: "Cursor prépare la réponse…" });
    const run = await agent.send(
      [
        systemPrompt(opts.ctx),
        "Tu n'as accès qu'aux outils fournis par le serveur MCP « custom-user-tools » ; n'essaie pas d'autres moyens d'agir sur l'ordinateur.",
        "",
        "Demande de l'utilisatrice :",
        opts.prompt,
      ].join("\n"),
    );
    const onAbort = () => void run.cancel().catch(() => {});
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let result;
    try {
      result = await waitWithProgress(run, emit);
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
    if (result.status === "cancelled") throw new Error("Annulé.");
    if (result.status === "error") throw new Error(`Erreur Cursor : ${result.error?.message ?? "inconnue"}`);
    const text = result.result ?? "";
    emit({ type: "message", text });
    return text;
  } finally {
    await closeQuietly(agent);
  }
}

/** Client « texte seul » (sans aucun outil) : sert au plan de rangement de dossier. */
export class CursorTextClient implements LlmClient {
  constructor(
    private readonly sdk: CursorSdkLike,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async chat(messages: ChatMessage[], opts: { json?: boolean; signal?: AbortSignal } = {}): Promise<ChatMessage> {
    if (opts.signal?.aborted) throw new Error("Annulé.");
    const prompt = [
      ...messages.map((m) => `${m.role === "system" ? "[Consignes]" : "[Message]"}\n${m.content ?? ""}`),
      opts.json ? "Réponds uniquement par un objet JSON valide, sans texte autour." : "",
    ].join("\n\n");
    const agent = await this.sdk.Agent.create({ apiKey: this.apiKey, model: { id: this.model }, tools: [], local: { cwd: os.tmpdir() } });
    try {
      const run = await agent.send(prompt);
      const onAbort = () => void run.cancel().catch(() => {});
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      let result;
      try {
        result = await run.wait();
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
      }
      if (result.status === "cancelled") throw new Error("Annulé.");
      if (result.status === "error") throw new Error(`Erreur Cursor : ${result.error?.message ?? "inconnue"}`);
      return { role: "assistant", content: result.result ?? "" };
    } finally {
      await closeQuietly(agent);
    }
  }
}

export async function listCursorModels(sdk: CursorSdkLike, apiKey: string): Promise<CursorModelInfo[]> {
  const models = await sdk.Cursor.models.list({ apiKey });
  return models.map((m) => ({ id: m.id, displayName: m.displayName, description: m.description }));
}
