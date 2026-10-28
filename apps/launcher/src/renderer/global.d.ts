interface LauncherState {
  settings: {
    shortcut: string;
    dictationShortcut: string;
    provider: string;
    baseUrl: string;
    model: string;
    transcriptionModel: string;
    transcriptionBaseUrl: string;
    allowedRoots: string[];
    projectsRoot: string;
    launchAtLogin: boolean;
  };
  history: string[];
  llmKeySource: "env" | "keychain" | "none";
  hasTranscriptionKey: boolean;
  secretsAvailable: boolean;
  defaults: { baseUrl: string; model: string };
  providers: Array<{ id: string; label: string; baseUrl: string; defaultModel: string }>;
  platform: string;
}

interface PlanMove {
  from: string;
  to: string;
  fromRel: string;
  toRel: string;
}

interface PlanView {
  folder: string;
  summary: string;
  moves: PlanMove[];
  skipped: Array<{ name: string; reason: string }>;
}

interface ApplyView {
  moved: Array<{ from: string; to: string }>;
  failed: Array<{ from: string; reason: string }>;
}

type AgentEventView =
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; output: string }
  | { type: "message"; text: string }
  | { type: "error"; text: string };

interface ConfirmView {
  id: string;
  title: string;
  detail: string;
  risk: "info" | "confirm" | "danger";
}

interface LauncherApi {
  getState(): Promise<LauncherState>;
  updateSettings(patch: Partial<LauncherState["settings"]>): Promise<{ state: LauncherState; errors: string[] }>;
  setSecret(name: "llm" | "transcription", value: string | null): Promise<{ state: LauncherState; error: string | null }>;
  runPrompt(prompt: string): Promise<{ ok: boolean; text: string }>;
  cancel(): Promise<void>;
  clearHistory(): Promise<string[]>;
  pickFolder(): Promise<string | null>;
  addAllowedFolder(): Promise<LauncherState>;
  pathForFile(file: File): string;
  planFolder(folder: string, prompt: string, preset: "type" | "prompt"): Promise<{ ok: true; id: string; plan: PlanView } | { ok: false; error: string }>;
  applyPlan(id: string, selected: string[]): Promise<{ ok: true; result: ApplyView } | { ok: false; error: string }>;
  undoOrganize(): Promise<{ ok: true; result: ApplyView } | { ok: false; error: string }>;
  ensureMic(): Promise<boolean>;
  transcribe(audio: ArrayBuffer, mime: string): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  answerConfirm(id: string, ok: boolean): Promise<void>;
  resize(height: number): Promise<void>;
  hide(): Promise<void>;
  onShown(cb: () => void): () => void;
  onToggleDictation(cb: () => void): () => void;
  onOpenSettings(cb: () => void): () => void;
  onConfirm(cb: (req: ConfirmView) => void): () => void;
  onAgentEvent(cb: (e: AgentEventView) => void): () => void;
}

interface Window {
  launcher: LauncherApi;
}
