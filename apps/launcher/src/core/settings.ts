import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_THEME, type ThemeSettings } from "./theme";

export interface Settings extends ThemeSettings {
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
  autoUpdate: boolean;
  /** Affiche aussi l'app dans le Dock (secours si l'icône de la barre de menus reste invisible). */
  showInDock: boolean;
  /** Affiche le nom « AlphaCris » à côté de l'icône de la barre de menus (plus facile à repérer). */
  trayLabel: boolean;
  /** Dire bonjour à voix haute à chaque lancement (« Bonjour, c'est Cris, à ton service. »). */
  greetOnLaunch: boolean;
  /** Lire les réponses à voix haute (voix du système) même en mode texte. */
  speakReplies: boolean;
  ttsVoice: string;
  ttsRate: number;
  /** Moteur de voix : Piper (neuronale, locale, gratuite) s'il est installé, sinon `say` (voix du Mac). */
  ttsEngine: "auto" | "piper" | "say";
  /** Interpréteur Python (ou binaire `piper`) à utiliser. Vide = ~/.cursor-launcher/piper/venv. */
  piperBin: string;
  /** Voix Piper (.onnx). Vide = première voix française de ~/.cursor-launcher/voices. */
  piperModel: string;
  /** Moteur de transcription : local (whisper.cpp), api (Whisper compatible OpenAI) ou auto (local si installé). */
  sttEngine: "auto" | "local" | "api";
  whisperBin: string;
  whisperModel: string;
  /** Répondre oui/non à voix haute aux confirmations (les actions « danger » restent au clic). */
  voiceConfirm: boolean;
  wakeWordEnabled: boolean;
  wakePhrase: string;
  /** Secondes d'écoute après une réponse, sans avoir à répéter le mot d'activation. */
  followUpSeconds: number;
}

export function defaultSettings(home = os.homedir()): Settings {
  return {
    shortcut: "Alt+Space",
    dictationShortcut: "Alt+Shift+Space",
    provider: "cursor",
    baseUrl: "",
    model: "",
    transcriptionModel: "whisper-1",
    transcriptionBaseUrl: "https://api.openai.com/v1",
    allowedRoots: [path.join(home, "Desktop"), path.join(home, "Documents"), path.join(home, "Downloads"), path.join(home, "Projects")],
    projectsRoot: path.join(home, "Projects"),
    launchAtLogin: false,
    autoUpdate: true,
    showInDock: false,
    trayLabel: true,
    greetOnLaunch: true,
    speakReplies: false,
    ttsVoice: "",
    ttsRate: 185,
    ttsEngine: "auto",
    piperBin: "",
    piperModel: "",
    sttEngine: "auto",
    whisperBin: "",
    whisperModel: "",
    voiceConfirm: true,
    wakeWordEnabled: false,
    wakePhrase: "hey cursor",
    followUpSeconds: 8,
    ...DEFAULT_THEME,
  };
}

export class SettingsStore {
  private data: Settings;

  constructor(private readonly file: string, home = os.homedir()) {
    this.data = { ...defaultSettings(home), ...this.read() };
  }

  private read(): Partial<Settings> {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<Settings>;
    } catch {
      return {};
    }
  }

  get(): Settings {
    return { ...this.data, allowedRoots: [...this.data.allowedRoots] };
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.data, ...patch };
    next.allowedRoots = Array.from(new Set(next.allowedRoots.map((r) => r.trim()).filter(Boolean)));
    this.data = next;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), { mode: 0o600 });
    return this.get();
  }
}

export const HISTORY_LIMIT = 100;

export class HistoryStore {
  private items: string[];

  constructor(private readonly file: string) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      this.items = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      this.items = [];
    }
  }

  list(): string[] {
    return [...this.items];
  }

  /** Ajoute en fin (le plus récent en dernier) ; dédoublonne l'entrée précédente identique. */
  add(prompt: string): string[] {
    const p = prompt.trim();
    if (!p) return this.list();
    this.items = this.items.filter((x) => x !== p);
    this.items.push(p);
    if (this.items.length > HISTORY_LIMIT) this.items = this.items.slice(-HISTORY_LIMIT);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.items), { mode: 0o600 });
    return this.list();
  }

  clear(): void {
    this.items = [];
    fs.rmSync(this.file, { force: true });
  }
}
