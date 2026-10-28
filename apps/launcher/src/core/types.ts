export type RiskLevel = "info" | "confirm" | "danger";

export interface ConfirmRequest {
  id: string;
  title: string;
  detail: string;
  risk: RiskLevel;
}

/** Callbacks fournis par l'hôte (Electron ou tests). */
export interface Host {
  confirm(req: Omit<ConfirmRequest, "id">): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  openApp(name: string): Promise<void>;
  trash(absPath: string): Promise<void>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface LlmClient {
  chat(
    messages: ChatMessage[],
    opts?: { tools?: ToolSchema[]; json?: boolean; signal?: AbortSignal },
  ): Promise<ChatMessage>;
}

export type AgentEvent =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; output: string }
  | { type: "progress"; text: string }
  | { type: "message"; text: string }
  | { type: "error"; text: string };
