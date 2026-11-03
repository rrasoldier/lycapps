import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Runner } from "./updater";

export interface LocalWhisperConfig {
  /** Binaire `whisper-cli` (whisper.cpp). Vide = détection automatique (Homebrew puis PATH). */
  bin: string;
  /** Modèle ggml (ex. ggml-small.bin). */
  model: string;
  language?: string;
}

export interface LocalWhisperStatus {
  ready: boolean;
  detail: string;
}

export const MODEL_HINT = "Installez-le avec : cd apps/launcher && npm run voice:install";

export function defaultModelPath(home: string = os.homedir(), name = "ggml-small.bin"): string {
  return path.join(home, ".cursor-launcher", "models", name);
}

/** Cherche un modèle déjà téléchargé (small de préférence, puis base, medium, tiny). */
export function findModel(home: string = os.homedir()): string | null {
  for (const name of ["ggml-small.bin", "ggml-base.bin", "ggml-medium.bin", "ggml-small-q5_1.bin", "ggml-base-q5_1.bin", "ggml-tiny.bin"]) {
    const p = defaultModelPath(home, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const BIN_CANDIDATES = ["/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"];

export function resolveWhisperBin(configured: string, exists: (p: string) => boolean = fs.existsSync): string {
  if (configured.trim()) return configured.trim();
  return BIN_CANDIDATES.find((c) => exists(c)) ?? "whisper-cli";
}

/** Vérifie (sans transcrire) que whisper.cpp et un modèle sont disponibles. */
export async function localWhisperStatus(cfg: LocalWhisperConfig, run: Runner, cwd = os.tmpdir()): Promise<LocalWhisperStatus> {
  const model = cfg.model.trim();
  if (!model) return { ready: false, detail: `Aucun modèle Whisper local trouvé. ${MODEL_HINT}` };
  if (!fs.existsSync(model)) return { ready: false, detail: `Modèle introuvable : ${model}. ${MODEL_HINT}` };
  const bin = resolveWhisperBin(cfg.bin);
  const found = path.isAbsolute(bin) ? { code: fs.existsSync(bin) ? 0 : 1 } : await run("which", [bin], { cwd, timeoutMs: 10_000 });
  if (found.code !== 0) return { ready: false, detail: `whisper.cpp introuvable (« ${bin} »). Installez-le avec : brew install whisper-cpp (ou ${MODEL_HINT.toLowerCase()})` };
  return { ready: true, detail: `whisper.cpp local prêt (${path.basename(model)}).` };
}

/** Transcrit un WAV (16 kHz mono) avec whisper.cpp, 100 % en local ; le fichier temporaire est effacé. */
export async function transcribeLocal(wav: Uint8Array, cfg: LocalWhisperConfig, run: Runner, tmpRoot = os.tmpdir()): Promise<string> {
  const model = cfg.model.trim();
  if (!model || !fs.existsSync(model)) {
    throw new Error(`Modèle Whisper local introuvable${model ? ` (${model})` : ""}. ${MODEL_HINT}`);
  }
  const dir = fs.mkdtempSync(path.join(tmpRoot, "launcher-stt-"));
  const file = path.join(dir, "speech.wav");
  try {
    fs.writeFileSync(file, wav, { mode: 0o600 });
    const bin = resolveWhisperBin(cfg.bin);
    const threads = String(Math.max(2, Math.min(8, os.cpus().length - 1)));
    const res = await run(bin, ["-m", model, "-l", cfg.language ?? "fr", "-t", threads, "-nt", "-np", "-f", file], { cwd: dir, timeoutMs: 90_000 });
    if (res.code === 127 || /not found|ENOENT/i.test(res.stderr)) {
      throw new Error("whisper.cpp introuvable. Installez-le avec : brew install whisper-cpp (puis relancez).");
    }
    if (res.code !== 0) throw new Error(`whisper.cpp a échoué : ${res.stderr.trim().split("\n").slice(-3).join(" ") || `code ${res.code}`}`);
    return res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
