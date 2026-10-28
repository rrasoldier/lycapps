import type { ChatMessage, LlmClient, ToolSchema } from "./types";

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  /** Variables d'environnement consultées, par ordre de priorité. */
  envKeys: string[];
  requiresKey: boolean;
}

/** Tous les fournisseurs parlent l'API « chat completions » compatible OpenAI. */
export const PROVIDERS: ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", envKeys: ["LAUNCHER_API_KEY", "OPENAI_API_KEY"], requiresKey: true },
  { id: "anthropic", label: "Anthropic (API compatible OpenAI)", baseUrl: "https://api.anthropic.com/v1", defaultModel: "claude-sonnet-4-5", envKeys: ["LAUNCHER_API_KEY", "ANTHROPIC_API_KEY"], requiresKey: true },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4.1-mini", envKeys: ["LAUNCHER_API_KEY", "OPENROUTER_API_KEY"], requiresKey: true },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", defaultModel: "llama3.1", envKeys: ["LAUNCHER_API_KEY"], requiresKey: false },
  { id: "custom", label: "Personnalisé (URL compatible OpenAI)", baseUrl: "", defaultModel: "", envKeys: ["LAUNCHER_API_KEY"], requiresKey: false },
];

export function getProvider(id: string): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function keyFromEnv(preset: ProviderPreset, env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of preset.envKeys) if (env[name]) return env[name];
  return undefined;
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatClient implements LlmClient {
  constructor(private readonly cfg: LlmConfig) {}

  async chat(
    messages: ChatMessage[],
    opts: { tools?: ToolSchema[]; json?: boolean; signal?: AbortSignal } = {},
  ): Promise<ChatMessage> {
    const body: Record<string, unknown> = { model: this.cfg.model, messages };
    if (opts.tools?.length) {
      body.tools = opts.tools;
      body.tool_choice = "auto";
    }
    if (opts.json) body.response_format = { type: "json_object" };

    const res = await (this.cfg.fetchImpl ?? fetch)(`${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Erreur LLM ${res.status} : ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: ChatMessage }> };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Réponse LLM vide ou invalide.");
    return { role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined };
  }
}
