import { TOOL_SCHEMAS, runTool, type ToolContext } from "./tools";
import type { AgentEvent, ChatMessage, LlmClient } from "./types";

export const MAX_STEPS = 12;

export function systemPrompt(ctx: ToolContext): string {
  return [
    "Tu es l'agent d'un lanceur macOS léger (type Alfred/Raycast). Tu agis sur l'ordinateur de l'utilisatrice via des outils.",
    "Réponds dans la langue de l'utilisatrice (français par défaut), de façon brève.",
    `Dossiers autorisés pour les fichiers : ${ctx.scope.roots.join(", ") || "(aucun)"}.`,
    `Les nouveaux projets sont créés dans : ${ctx.projectsRoot}.`,
    "Règles : n'invente jamais le contenu d'un fichier que tu n'as pas lu ; préfère list_files/read_file avant d'agir ; n'utilise run_shell que si aucun autre outil ne convient ;",
    "write_file n'écrit que du texte (UTF-8) : pour un « Excel », crée un fichier .csv (qui s'ouvre dans Excel) et dis-le clairement ; ne prétends jamais avoir créé un .xlsx sans l'avoir réellement généré.",
    "chaque action sensible demande une confirmation à l'utilisatrice — si elle refuse, n'insiste pas et propose une alternative ; ne supprime rien sans que ce soit explicitement demandé (trash_file uniquement).",
  ].join("\n");
}

export interface RunAgentOptions {
  llm: LlmClient;
  ctx: ToolContext;
  prompt: string;
  history?: ChatMessage[];
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
  maxSteps?: number;
}

export interface AgentOutcome {
  text: string;
  messages: ChatMessage[];
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentOutcome> {
  const emit = opts.onEvent ?? (() => {});
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(opts.ctx) },
    ...(opts.history ?? []),
    { role: "user", content: opts.prompt },
  ];
  const max = opts.maxSteps ?? MAX_STEPS;

  for (let step = 0; step < max; step++) {
    if (opts.signal?.aborted) throw new Error("Annulé.");
    const reply = await opts.llm.chat(messages, { tools: TOOL_SCHEMAS, signal: opts.signal });
    messages.push(reply);
    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      const text = reply.content ?? "";
      emit({ type: "message", text });
      return { text, messages };
    }
    if (reply.content?.trim()) emit({ type: "progress", text: reply.content.trim() });
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      let parseError: string | null = null;
      try {
        const parsed = JSON.parse(call.function.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
        else parseError = "Les arguments doivent être un objet JSON.";
      } catch {
        parseError = "Arguments JSON invalides.";
      }
      emit({ type: "tool_call", name: call.function.name, args });
      const result = parseError
        ? { ok: false, output: parseError }
        : await runTool(call.function.name, args, opts.ctx);
      emit({ type: "tool_result", name: call.function.name, ok: result.ok, output: result.output });
      messages.push({ role: "tool", tool_call_id: call.id, content: `${result.ok ? "OK" : "ERREUR"}: ${result.output}` });
    }
  }
  const text = `Arrêt : limite de ${max} étapes atteinte.`;
  emit({ type: "error", text });
  return { text, messages };
}
