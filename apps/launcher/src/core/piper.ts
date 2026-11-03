import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Runner } from "./updater";

/**
 * Voix neuronale locale et gratuite : Piper (https://github.com/OHF-Voice/piper1-gpl).
 *
 * Piper est sous licence GPL-3.0 : il n'est ni embarqué ni lié à l'application, il est installé à part
 * (environnement Python dans ~/.cursor-launcher/piper) et lancé comme un programme externe. Les voix
 * sont des fichiers `.onnx` téléchargés séparément, chacune avec sa propre licence (voir README).
 */

export const PIPER_VOICE = "fr_FR-siwis-medium";
export const PIPER_HINT = "Installez-la avec : cd apps/launcher && npm run tts:install";

export type TtsEngine = "auto" | "piper" | "say";

export interface TtsSettings {
  ttsEngine: TtsEngine;
  piperBin: string;
  piperModel: string;
  ttsRate: number;
}

export interface PiperConfig {
  bin: string;
  model: string;
}

export function piperDir(home: string = os.homedir()): string {
  return path.join(home, ".cursor-launcher", "piper");
}

export function voicesDir(home: string = os.homedir()): string {
  return path.join(home, ".cursor-launcher", "voices");
}

export function defaultPiperBin(home: string = os.homedir()): string {
  return path.join(piperDir(home), "venv", "bin", "python3");
}

/** Cherche une voix déjà téléchargée : la voix par défaut, puis toute voix française, puis n'importe laquelle. */
export function findPiperModel(home: string = os.homedir(), list: (dir: string) => string[] = safeList): string | null {
  const dir = voicesDir(home);
  const models = list(dir).filter((f) => f.endsWith(".onnx"));
  const pick = models.find((f) => f === `${PIPER_VOICE}.onnx`) ?? models.find((f) => f.startsWith("fr_")) ?? models[0];
  return pick ? path.join(dir, pick) : null;
}

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Un interpréteur Python se lance avec `-m piper` ; tout autre binaire (`piper`) est lancé tel quel. */
export function isPythonBin(bin: string): boolean {
  return /^python[\d.]*(\.exe)?$/i.test(path.basename(bin));
}

/** Débit en mots/minute (réglage commun avec `say`, 185 par défaut) -> durée des phonèmes de Piper (1 = voix naturelle). */
export function lengthScaleFor(rate: number | undefined): number {
  const r = typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 185;
  return Math.round(Math.min(1.6, Math.max(0.6, 185 / r)) * 100) / 100;
}

/** Ligne de commande d'un processus Piper qui lit une phrase par ligne sur stdin et écrit un WAV par phrase. */
export function piperCommand(cfg: PiperConfig, outDir: string, lengthScale: number): { cmd: string; args: string[] } {
  const args = [
    ...(isPythonBin(cfg.bin) ? ["-m", "piper"] : []),
    "-m",
    cfg.model,
    "-d",
    outDir,
    "--output-dir-naming",
    "timestamp",
    "--length-scale",
    String(lengthScale),
    "--sentence-silence",
    "0.1",
  ];
  return { cmd: cfg.bin, args };
}

/** Extrait le chemin du WAV d'une ligne de journal de Piper (« INFO:__main__:Wrote /tmp/x/123.wav »). */
export function parseWroteLine(line: string): string | null {
  const m = /Wrote\s+(.+?\.wav)\s*$/.exec(line.trim());
  return m ? m[1] : null;
}

/** Texte envoyé à Piper : une seule ligne, et rien du tout s'il n'y a rien à prononcer (Piper n'écrirait aucun fichier). */
export function piperText(sentence: string): string {
  const t = sentence.replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : "";
}

export type TtsResolution =
  | { engine: "piper"; cfg: PiperConfig; detail: string }
  | { engine: "say"; detail: string; piperReason?: string };

/** Choisit le moteur : Piper s'il est installé (ou demandé), sinon la voix du système. */
export function resolveTts(s: TtsSettings, home: string = os.homedir(), exists: (p: string) => boolean = fs.existsSync): TtsResolution {
  if (s.ttsEngine === "say") return { engine: "say", detail: "Voix du Mac (say), choisie dans les réglages." };
  const bin = s.piperBin.trim() || defaultPiperBin(home);
  const model = s.piperModel.trim() || findPiperModel(home) || "";
  const why = !model
    ? `Aucune voix Piper trouvée dans ${voicesDir(home)}. ${PIPER_HINT}`
    : !exists(model)
      ? `Voix Piper introuvable : ${model}. ${PIPER_HINT}`
      : !exists(`${model}.json`)
        ? `Fichier ${model}.json manquant à côté de la voix. ${PIPER_HINT}`
        : path.isAbsolute(bin) && !exists(bin)
          ? `Piper introuvable (${bin}). ${PIPER_HINT}`
          : "";
  if (why) return { engine: "say", detail: s.ttsEngine === "piper" ? `Piper demandé mais indisponible : ${why} Repli sur la voix du Mac.` : `Voix du Mac (say). ${why}`, piperReason: why };
  return { engine: "piper", cfg: { bin, model }, detail: `Piper local prêt (${path.basename(model, ".onnx")}).` };
}

/** Vérifie que le module Python `piper` est bien installé dans l'interpréteur choisi (sans rien synthétiser). */
export async function piperModuleStatus(cfg: PiperConfig, run: Runner, cwd = os.tmpdir()): Promise<{ ok: boolean; detail: string }> {
  if (!isPythonBin(cfg.bin)) return { ok: true, detail: "" };
  const r = await run(cfg.bin, ["-c", "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('piper') else 1)"], { cwd, timeoutMs: 10_000 });
  return r.code === 0 ? { ok: true, detail: "" } : { ok: false, detail: `Le module Python « piper » est absent de ${cfg.bin}. ${PIPER_HINT}` };
}
