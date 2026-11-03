import * as fs from "node:fs";
import * as path from "node:path";
import type { Scope } from "./security";
import type { ChatMessage, LlmClient } from "./types";

export const MAX_ORGANIZE_FILES = 500;

export interface FileInfo {
  name: string;
  size: number;
  mtime: string;
}

export interface PlannedMove {
  from: string;
  to: string;
  /** Chemins relatifs au dossier, pour l'affichage. */
  fromRel: string;
  toRel: string;
}

export interface OrganizePlan {
  folder: string;
  summary: string;
  moves: PlannedMove[];
  /** Éléments ignorés avec la raison (collision, hors dossier…). */
  skipped: Array<{ name: string; reason: string }>;
}

/** Catégories pour le préréglage « par type » (sans IA). */
export const TYPE_CATEGORIES: Record<string, string[]> = {
  Images: ["jpg", "jpeg", "png", "gif", "heic", "webp", "svg", "bmp", "tiff", "raw"],
  Documents: ["pdf", "doc", "docx", "txt", "rtf", "md", "pages", "odt", "epub"],
  Tableurs: ["xls", "xlsx", "csv", "numbers", "ods"],
  Présentations: ["ppt", "pptx", "key", "odp"],
  Vidéos: ["mp4", "mov", "avi", "mkv", "webm", "m4v"],
  Audio: ["mp3", "wav", "aac", "flac", "m4a", "ogg", "aiff"],
  Archives: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2"],
  "Installeurs": ["dmg", "pkg", "iso", "exe", "msi"],
  Code: ["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "cpp", "h", "swift", "sh", "json", "yml", "yaml", "html", "css", "sql"],
};

export function categoryFor(fileName: string): string {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (!ext) return "Autres";
  for (const [cat, exts] of Object.entries(TYPE_CATEGORIES)) if (exts.includes(ext)) return cat;
  return "Autres";
}

/** Fichiers du premier niveau (hors fichiers cachés et dossiers). */
export function scanFolder(folder: string): FileInfo[] {
  const out: FileInfo[] = [];
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    if (e.name.startsWith(".") || !e.isFile()) continue;
    const st = fs.statSync(path.join(folder, e.name));
    out.push({ name: e.name, size: st.size, mtime: st.mtime.toISOString().slice(0, 10) });
    if (out.length >= MAX_ORGANIZE_FILES) break;
  }
  return out;
}

export function planByType(folder: string, files: FileInfo[]): Array<{ name: string; dest: string }> {
  return files.map((f) => ({ name: f.name, dest: categoryFor(f.name) }));
}

/**
 * Transforme des affectations « fichier → sous-dossier » en plan sûr :
 * – tout est validé dans le périmètre autorisé et dans le dossier cible ;
 * – aucune destination existante n'est écrasée, ni collision entre deux déplacements ;
 * – aucun déplacement vers le même emplacement.
 */
export function buildPlan(
  folder: string,
  scope: Scope,
  files: FileInfo[],
  assignments: Array<{ name: string; dest: string }>,
  summary: string,
): OrganizePlan {
  const root = scope.resolve(folder);
  const known = new Set(files.map((f) => f.name));
  const moves: PlannedMove[] = [];
  const skipped: OrganizePlan["skipped"] = [];
  const taken = new Set<string>();

  for (const a of assignments) {
    if (!a || typeof a.name !== "string" || typeof a.dest !== "string") continue;
    if (!known.has(a.name)) {
      skipped.push({ name: String(a.name), reason: "fichier inconnu" });
      continue;
    }
    const destDir = a.dest.replace(/^\/+|\/+$/g, "");
    if (!destDir || destDir === ".") continue;
    let to: string;
    try {
      to = scope.resolve(path.join(root, destDir, a.name));
    } catch {
      skipped.push({ name: a.name, reason: "destination refusée" });
      continue;
    }
    if (path.relative(root, to).startsWith("..")) {
      skipped.push({ name: a.name, reason: "destination hors du dossier" });
      continue;
    }
    const from = path.join(root, a.name);
    if (to === from) continue;
    if (fs.existsSync(to) || taken.has(to)) {
      skipped.push({ name: a.name, reason: "un fichier existe déjà à destination" });
      continue;
    }
    taken.add(to);
    moves.push({ from, to, fromRel: path.relative(root, from), toRel: path.relative(root, to) });
  }
  return { folder: root, summary, moves, skipped };
}

const ORGANIZER_SYSTEM = `Tu planifies le rangement d'un dossier. On te donne une consigne et la liste des fichiers (nom, taille, date).
Réponds UNIQUEMENT par un objet JSON : {"summary": string, "assignments": [{"name": string, "dest": string}]}
- "name" est exactement le nom d'un fichier de la liste ; "dest" est un sous-dossier relatif (ex: "Images/2024"), jamais absolu, jamais "..".
- Ne mets dans assignments que les fichiers à déplacer. Ne supprime ni ne renomme rien. Max 2 niveaux de sous-dossiers.`;

export async function planWithLlm(
  llm: LlmClient,
  folder: string,
  scope: Scope,
  files: FileInfo[],
  prompt: string,
  signal?: AbortSignal,
): Promise<OrganizePlan> {
  const messages: ChatMessage[] = [
    { role: "system", content: ORGANIZER_SYSTEM },
    { role: "user", content: `Consigne : ${prompt}\n\nFichiers :\n${files.map((f) => `${f.name}\t${f.size}\t${f.mtime}`).join("\n")}` },
  ];
  const reply = await llm.chat(messages, { json: true, signal });
  const parsed = parseJsonObject(reply.content ?? "");
  const assignments = Array.isArray(parsed.assignments) ? (parsed.assignments as Array<{ name: string; dest: string }>) : [];
  const summary = typeof parsed.summary === "string" ? parsed.summary : "Plan proposé par l'IA.";
  return buildPlan(folder, scope, files, assignments, summary);
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("La réponse de l'IA n'est pas un JSON valide.");
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("La réponse de l'IA n'est pas un JSON valide.");
  }
}

export interface ApplyResult {
  moved: Array<{ from: string; to: string }>;
  failed: Array<{ from: string; reason: string }>;
}

/** Applique un plan (déjà confirmé). Rejoue les vérifications au moment de l'application. */
export function applyPlan(plan: OrganizePlan, scope: Scope, selected?: Set<string>): ApplyResult {
  const moved: ApplyResult["moved"] = [];
  const failed: ApplyResult["failed"] = [];
  for (const m of plan.moves) {
    if (selected && !selected.has(m.from)) continue;
    try {
      const from = scope.resolve(m.from);
      const to = scope.resolve(m.to);
      if (!fs.existsSync(from)) throw new Error("source introuvable");
      if (fs.existsSync(to)) throw new Error("la destination existe déjà");
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      moved.push({ from, to });
    } catch (e) {
      failed.push({ from: m.from, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { moved, failed };
}

/** Annule un rangement en inversant les déplacements (sans écraser). */
export function undoMoves(moved: ApplyResult["moved"], scope: Scope): ApplyResult {
  const undone: ApplyResult["moved"] = [];
  const failed: ApplyResult["failed"] = [];
  for (const m of [...moved].reverse()) {
    try {
      const from = scope.resolve(m.to);
      const to = scope.resolve(m.from);
      if (!fs.existsSync(from)) throw new Error("fichier introuvable");
      if (fs.existsSync(to)) throw new Error("l'emplacement d'origine est occupé");
      fs.renameSync(from, to);
      undone.push({ from, to });
      const dir = path.dirname(from);
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (e) {
      failed.push({ from: m.to, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { moved: undone, failed };
}
