import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface Settings {
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
}

export function defaultSettings(home = os.homedir()): Settings {
  return {
    shortcut: "Alt+Space",
    dictationShortcut: "Alt+Shift+Space",
    provider: "openai",
    baseUrl: "",
    model: "",
    transcriptionModel: "whisper-1",
    transcriptionBaseUrl: "https://api.openai.com/v1",
    allowedRoots: [path.join(home, "Desktop"), path.join(home, "Documents"), path.join(home, "Downloads"), path.join(home, "Projects")],
    projectsRoot: path.join(home, "Projects"),
    launchAtLogin: false,
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
