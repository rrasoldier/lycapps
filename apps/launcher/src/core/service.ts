import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAgent } from "./agent";
import {
  CursorTextClient,
  closeCursorSession,
  listCursorModels,
  loadCursorSdk,
  newCursorSession,
  runCursorAgent,
  type CursorModelInfo,
  type CursorSdkLike,
} from "./cursor";
import { OpenAiCompatClient, getProvider, keyFromEnv } from "./llm";
import {
  applyPlan,
  planByType,
  planWithLlm,
  buildPlan,
  scanFolder,
  undoMoves,
  type ApplyResult,
  type OrganizePlan,
} from "./organizer";
import { Scope, expandHome, realpathLoose } from "./security";
import type { Settings } from "./settings";
import { transcribeAudio } from "./transcribe";
import type { ToolContext } from "./tools";
import type { AgentEvent, ChatMessage, Host, LlmClient } from "./types";

export interface SecretStore {
  get(name: string): string | undefined;
  set(name: string, value: string | null): void;
  available(): boolean;
}

export interface ServiceDeps {
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>): Settings;
  home?: string;
  secrets: SecretStore;
  host: Host;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Chargeur du SDK Cursor (injectable pour les tests). Par défaut : `@cursor/sdk`. */
  cursorSdk?: () => Promise<CursorSdkLike>;
  /** Permet d'injecter un faux LLM dans les tests. */
  llmFactory?: (s: Settings, apiKey: string | undefined) => LlmClient;
}

/** Une entrée de trousseau par fournisseur : une clé n'est jamais envoyée à un autre fournisseur. */
export const llmSecretName = (provider: string) => `llm-api-key:${provider}`;
export const SECRET_TRANSCRIPTION = "transcription-api-key";

export const MAX_HISTORY_MESSAGES = 60;

/** Borne la mémoire en coupant sur un message utilisateur (jamais entre un appel d'outil et sa réponse). */
export function trimHistory(messages: ChatMessage[], max = MAX_HISTORY_MESSAGES): ChatMessage[] {
  if (messages.length <= max) return messages;
  const start = messages.findIndex((m, i) => i >= messages.length - max && m.role === "user");
  return start === -1 ? [] : messages.slice(start);
}

export class LauncherService {
  private plans = new Map<string, OrganizePlan>();
  private lastApplied: ApplyResult["moved"] = [];
  private controller: AbortController | null = null;
  private history: ChatMessage[] = [];
  private historyKey = "";
  private readonly cursorSession = newCursorSession();

  constructor(private readonly deps: ServiceDeps) {}

  private get env() {
    return this.deps.env ?? process.env;
  }

  scope(): Scope {
    return new Scope({ allowedRoots: this.deps.getSettings().allowedRoots });
  }

  llmApiKey(): string | undefined {
    const s = this.deps.getSettings();
    return keyFromEnv(getProvider(s.provider), this.env) ?? this.deps.secrets.get(llmSecretName(s.provider));
  }

  llmKeySource(): "env" | "keychain" | "none" {
    const s = this.deps.getSettings();
    if (keyFromEnv(getProvider(s.provider), this.env)) return "env";
    return this.deps.secrets.get(llmSecretName(s.provider)) ? "keychain" : "none";
  }

  transcriptionKey(): string | undefined {
    const s = this.deps.getSettings();
    return (
      this.env.LAUNCHER_TRANSCRIPTION_API_KEY ||
      this.env.OPENAI_API_KEY ||
      this.deps.secrets.get(SECRET_TRANSCRIPTION) ||
      (s.provider === "openai" ? this.llmApiKey() : undefined)
    );
  }

  private isCursor(): boolean {
    return getProvider(this.deps.getSettings().provider).kind === "cursor";
  }

  private requireKey(): string {
    const preset = getProvider(this.deps.getSettings().provider);
    const apiKey = this.llmApiKey();
    if (preset.requiresKey && !apiKey) {
      throw new Error(
        `Aucune clé API pour ${preset.label}. Définissez ${preset.envKeys.join(" ou ")} ou enregistrez-la dans les réglages (trousseau).`,
      );
    }
    return apiKey ?? "";
  }

  private async cursorSdk(): Promise<CursorSdkLike> {
    return (this.deps.cursorSdk ?? loadCursorSdk)();
  }

  private async llm(): Promise<LlmClient> {
    const s = this.deps.getSettings();
    const preset = getProvider(s.provider);
    const apiKey = this.requireKey();
    if (preset.kind === "cursor") return new CursorTextClient(await this.cursorSdk(), apiKey, s.model || preset.defaultModel);
    if (this.deps.llmFactory) return this.deps.llmFactory(s, apiKey || undefined);
    const baseUrl = s.baseUrl || preset.baseUrl;
    const model = s.model || preset.defaultModel;
    if (!baseUrl || !model) throw new Error("URL de base et modèle requis dans les réglages.");
    return new OpenAiCompatClient({ baseUrl, model, apiKey: apiKey || undefined, fetchImpl: this.deps.fetchImpl });
  }

  /** Modèles disponibles pour la clé Cursor (catalogue du compte/équipe). */
  async listModels(): Promise<CursorModelInfo[]> {
    if (!this.isCursor()) throw new Error("La liste des modèles n'est disponible que pour le fournisseur Cursor.");
    const apiKey = this.requireKey();
    return listCursorModels(await this.cursorSdk(), apiKey);
  }

  private toolContext(): ToolContext {
    const s = this.deps.getSettings();
    return { scope: this.scope(), host: this.deps.host, projectsRoot: s.projectsRoot };
  }

  /** Oublie la conversation en cours (mémoire de l'agent). */
  async resetConversation(): Promise<void> {
    this.history = [];
    this.historyKey = "";
    await closeCursorSession(this.cursorSession);
  }

  cancel(): void {
    this.controller?.abort();
  }

  async runPrompt(prompt: string, onEvent: (e: AgentEvent) => void): Promise<string> {
    this.controller = new AbortController();
    try {
      if (this.isCursor()) {
        const s = this.deps.getSettings();
        const apiKey = this.requireKey();
        return await runCursorAgent({
          sdk: await this.cursorSdk(),
          session: this.cursorSession,
          apiKey,
          model: s.model || getProvider(s.provider).defaultModel,
          ctx: this.toolContext(),
          prompt,
          onEvent,
          signal: this.controller.signal,
        });
      }
      const s = this.deps.getSettings();
      const key = `${s.provider}|${s.model}|${s.baseUrl}`;
      if (key !== this.historyKey) {
        this.history = [];
        this.historyKey = key;
      }
      const out = await runAgent({
        llm: await this.llm(),
        ctx: this.toolContext(),
        prompt,
        history: this.history,
        onEvent,
        signal: this.controller.signal,
      });
      this.history = trimHistory(out.messages.slice(1));
      return out.text;
    } finally {
      this.controller = null;
    }
  }

  /** Dépose/sélection d'un dossier hors périmètre : demande d'autorisation explicite. */
  private async ensureFolderAllowed(folder: string): Promise<void> {
    if (this.scope().contains(folder)) return;
    const abs = path.resolve(expandHome(folder));
    const real = realpathLoose(abs);
    if (real === path.parse(real).root) throw new Error("Impossible d'autoriser la racine du disque.");
    if (!fs.existsSync(real) || !fs.statSync(real).isDirectory()) throw new Error("Ce n'est pas un dossier.");
    const isHome = real === realpathLoose(this.deps.home ?? os.homedir());
    const ok = await this.deps.host.confirm({
      title: "Autoriser ce dossier ?",
      detail: [
        real,
        "L'agent pourra lire, écrire et déplacer des fichiers dans ce dossier et ses sous-dossiers.",
        ...(isHome ? ["⚠ Il s'agit de votre dossier personnel entier."] : []),
      ].join("\n"),
      risk: isHome ? "danger" : "confirm",
    });
    if (!ok) throw new Error("Dossier non autorisé.");
    const s = this.deps.getSettings();
    this.deps.updateSettings({ allowedRoots: [...s.allowedRoots, real] });
  }

  /** Mode dossier : produit un plan, sans rien modifier (dry-run). */
  async planFolder(folder: string, prompt: string, preset: "type" | "prompt"): Promise<{ id: string; plan: OrganizePlan }> {
    await this.ensureFolderAllowed(folder);
    const scope = this.scope();
    const root = scope.resolve(folder);
    const files = scanFolder(root);
    if (files.length === 0) throw new Error("Aucun fichier à ranger au premier niveau de ce dossier.");
    let plan: OrganizePlan;
    if (preset === "type") {
      plan = buildPlan(root, scope, files, planByType(root, files), "Rangement par type de fichier (sans IA).");
    } else {
      if (!prompt.trim()) throw new Error("Décrivez comment ranger ce dossier.");
      this.controller = new AbortController();
      try {
        plan = await planWithLlm(await this.llm(), root, scope, files, prompt, this.controller.signal);
      } finally {
        this.controller = null;
      }
    }
    const id = randomUUID();
    this.plans.set(id, plan);
    return { id, plan };
  }

  async applyFolderPlan(id: string, selectedFrom?: string[]): Promise<ApplyResult> {
    const plan = this.plans.get(id);
    if (!plan) throw new Error("Plan introuvable ou expiré : relancez l'aperçu.");
    const selected = selectedFrom ? new Set(selectedFrom) : undefined;
    const count = selected ? plan.moves.filter((m) => selected.has(m.from)).length : plan.moves.length;
    if (count === 0) throw new Error("Aucun déplacement sélectionné.");
    const ok = await this.deps.host.confirm({
      title: `Appliquer ${count} déplacement(s) ?`,
      detail: `${plan.folder}\nAucun fichier ne sera supprimé ni écrasé. Annulation possible juste après.`,
      risk: "confirm",
    });
    if (!ok) throw new Error("Refusé par l'utilisateur.");
    const result = applyPlan(plan, this.scope(), selected);
    this.lastApplied = result.moved;
    this.plans.delete(id);
    return result;
  }

  undoLastOrganize(): ApplyResult {
    if (this.lastApplied.length === 0) throw new Error("Rien à annuler.");
    const result = undoMoves(this.lastApplied, this.scope());
    this.lastApplied = result.failed.length ? this.lastApplied.filter((m) => result.failed.some((f) => f.from === m.to)) : [];
    return result;
  }

  async transcribe(audio: Uint8Array, mimeType: string): Promise<string> {
    const key = this.transcriptionKey();
    if (!key) {
      throw new Error("Aucune clé pour la transcription (OPENAI_API_KEY ou LAUNCHER_TRANSCRIPTION_API_KEY, ou réglages).");
    }
    const s = this.deps.getSettings();
    return transcribeAudio(audio, mimeType, {
      baseUrl: s.transcriptionBaseUrl,
      model: s.transcriptionModel,
      apiKey: key,
      fetchImpl: this.deps.fetchImpl,
    });
  }
}
