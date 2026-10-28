import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Scope, ScopeError, classifyShellCommand, isSafeAppName, isSafeUrl } from "./security";
import type { Host, ToolSchema } from "./types";

export const MAX_READ_BYTES = 200_000;
export const MAX_SHELL_OUTPUT = 20_000;
export const SHELL_TIMEOUT_MS = 60_000;
export const MAX_LIST_ENTRIES = 500;

export interface ToolContext {
  scope: Scope;
  host: Host;
  /** Dossier où `create_project` crée les projets (doit être dans le périmètre). */
  projectsRoot: string;
  shellTimeoutMs?: number;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

type Args = Record<string, unknown>;

interface ToolDef {
  schema: ToolSchema;
  run(args: Args, ctx: ToolContext): Promise<string>;
}

function str(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v) throw new Error(`Paramètre « ${key} » manquant ou invalide.`);
  return v;
}

function schema(name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSchema {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… [tronqué, ${text.length - max} caractères omis]`;
}

function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeProjectName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+|-+$/g, "");
  if (!cleaned) throw new Error("Nom de projet invalide.");
  return cleaned.slice(0, 80);
}

const tools: Record<string, ToolDef> = {
  list_files: {
    schema: schema(
      "list_files",
      "Liste le contenu d'un dossier (nom, type, taille). Non récursif.",
      { path: { type: "string", description: "Dossier à lister (absolu ou relatif au premier dossier autorisé)." } },
      ["path"],
    ),
    async run(args, ctx) {
      const dir = ctx.scope.resolve(str(args, "path"));
      const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, MAX_LIST_ENTRIES);
      const lines = entries.map((e) => {
        if (e.isDirectory()) return `[dir]  ${e.name}/`;
        let size = 0;
        try {
          size = fs.statSync(path.join(dir, e.name)).size;
        } catch {
          /* lien cassé */
        }
        return `[file] ${e.name} (${size} o)`;
      });
      return lines.length ? lines.join("\n") : "(dossier vide)";
    },
  },

  read_file: {
    schema: schema(
      "read_file",
      `Lit un fichier texte (UTF-8), tronqué à ${MAX_READ_BYTES} octets.`,
      { path: { type: "string" } },
      ["path"],
    ),
    async run(args, ctx) {
      const file = ctx.scope.resolve(str(args, "path"));
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error("Ce n'est pas un fichier.");
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
        fs.readSync(fd, buf, 0, buf.length, 0);
        const suffix = stat.size > MAX_READ_BYTES ? `\n… [tronqué : ${stat.size} octets au total]` : "";
        return buf.toString("utf8") + suffix;
      } finally {
        fs.closeSync(fd);
      }
    },
  },

  write_file: {
    schema: schema(
      "write_file",
      "Écrit un fichier texte. Crée les dossiers parents. L'écrasement d'un fichier existant demande confirmation.",
      { path: { type: "string" }, content: { type: "string" } },
      ["path", "content"],
    ),
    async run(args, ctx) {
      const file = ctx.scope.resolve(str(args, "path"));
      const content = typeof args.content === "string" ? args.content : "";
      if (exists(file)) {
        const ok = await ctx.host.confirm({
          title: "Écraser un fichier existant ?",
          detail: `${file}\n(${Buffer.byteLength(content)} octets seront écrits)`,
          risk: "confirm",
        });
        if (!ok) throw new Error("Refusé par l'utilisateur.");
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
      return `Fichier écrit : ${file}`;
    },
  },

  move_file: {
    schema: schema(
      "move_file",
      "Déplace ou renomme un fichier/dossier. N'écrase jamais une destination existante. Demande confirmation.",
      { from: { type: "string" }, to: { type: "string" } },
      ["from", "to"],
    ),
    async run(args, ctx) {
      const from = ctx.scope.resolve(str(args, "from"));
      const to = ctx.scope.resolve(str(args, "to"));
      if (!exists(from)) throw new Error(`Source introuvable : ${from}`);
      if (exists(to)) throw new Error(`La destination existe déjà : ${to} (aucun écrasement).`);
      const ok = await ctx.host.confirm({ title: "Déplacer ?", detail: `${from}\n→ ${to}`, risk: "confirm" });
      if (!ok) throw new Error("Refusé par l'utilisateur.");
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      return `Déplacé : ${from} → ${to}`;
    },
  },

  trash_file: {
    schema: schema(
      "trash_file",
      "Met un fichier ou dossier à la Corbeille (réversible). Demande toujours confirmation.",
      { path: { type: "string" } },
      ["path"],
    ),
    async run(args, ctx) {
      const target = ctx.scope.resolve(str(args, "path"));
      if (ctx.scope.roots.includes(target)) throw new Error("Impossible de supprimer un dossier racine autorisé.");
      if (!exists(target)) throw new Error(`Introuvable : ${target}`);
      const ok = await ctx.host.confirm({
        title: "Mettre à la Corbeille ?",
        detail: target,
        risk: "danger",
      });
      if (!ok) throw new Error("Refusé par l'utilisateur.");
      await ctx.host.trash(target);
      return `Mis à la Corbeille : ${target}`;
    },
  },

  run_shell: {
    schema: schema(
      "run_shell",
      `Exécute une commande shell (zsh/sh) dans un dossier autorisé. Toujours soumise à confirmation. Timeout ${SHELL_TIMEOUT_MS / 1000}s.`,
      {
        command: { type: "string" },
        cwd: { type: "string", description: "Dossier de travail (dans le périmètre autorisé)." },
      },
      ["command"],
    ),
    async run(args, ctx) {
      const command = str(args, "command");
      const cwd = typeof args.cwd === "string" && args.cwd ? ctx.scope.resolve(args.cwd) : ctx.scope.roots[0];
      if (!cwd) throw new ScopeError("Aucun dossier autorisé n'est configuré.");
      const { risk, reasons } = classifyShellCommand(command);
      const ok = await ctx.host.confirm({
        title: risk === "danger" ? "Commande potentiellement dangereuse" : "Exécuter cette commande ?",
        detail: `$ ${command}\n(dans ${cwd})${reasons.length ? `\n⚠ ${reasons.join("; ")}` : ""}`,
        risk: risk === "danger" ? "danger" : "confirm",
      });
      if (!ok) throw new Error("Refusé par l'utilisateur.");
      return await new Promise<string>((resolve, reject) => {
        exec(
          command,
          { cwd, timeout: ctx.shellTimeoutMs ?? SHELL_TIMEOUT_MS, maxBuffer: 5_000_000, env: { ...process.env, TERM: "dumb" } },
          (err, stdout, stderr) => {
            const out = truncate(`${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim(), MAX_SHELL_OUTPUT);
            if (err) {
              const code = (err as NodeJS.ErrnoException & { killed?: boolean }).killed
                ? "timeout"
                : `code ${(err as { code?: unknown }).code}`;
              reject(new Error(`Échec (${code}).\n${out}`));
            } else resolve(out || "(aucune sortie)");
          },
        );
      });
    },
  },

  ask_user: {
    schema: schema(
      "ask_user",
      "Pose une question à l'utilisatrice et attend sa réponse. À utiliser dès qu'une précision est nécessaire (au lieu de deviner). Propose 2 à 5 choix courts quand c'est possible : elle pourra cliquer ou répondre librement.",
      {
        question: { type: "string" },
        choices: { type: "array", items: { type: "string" }, description: "Choix proposés (2 à 5, courts). Facultatif." },
        allow_text: { type: "boolean", description: "Autoriser une réponse libre (défaut : true)." },
      },
      ["question"],
    ),
    async run(args, ctx) {
      const question = str(args, "question");
      const choices = Array.isArray(args.choices)
        ? args.choices.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim().slice(0, 80)).slice(0, 6)
        : [];
      const allowText = args.allow_text === false && choices.length > 0 ? false : true;
      const answer = await ctx.host.ask({ question, choices, allowText });
      if (answer === null) throw new Error("L'utilisatrice n'a pas répondu à la question.");
      return `Réponse de l'utilisatrice : ${answer}`;
    },
  },

  open_app: {
    schema: schema("open_app", "Ouvre une application macOS par son nom (ex: « Safari »).", { name: { type: "string" } }, ["name"]),
    async run(args, ctx) {
      const name = str(args, "name");
      if (!isSafeAppName(name)) throw new Error("Nom d'application invalide.");
      await ctx.host.openApp(name);
      return `Application ouverte : ${name}`;
    },
  },

  open_url: {
    schema: schema("open_url", "Ouvre une URL (http, https, mailto) dans le navigateur par défaut.", { url: { type: "string" } }, ["url"]),
    async run(args, ctx) {
      const url = str(args, "url");
      if (!isSafeUrl(url)) throw new Error("URL refusée (seuls http, https et mailto sont autorisés).");
      await ctx.host.openExternal(url);
      return `URL ouverte : ${url}`;
    },
  },

  create_project: {
    schema: schema(
      "create_project",
      "Crée un nouveau projet : un dossier dédié contenant les fichiers fournis. Génère toi-même le contenu complet de chaque fichier à partir de la demande. Refuse si le dossier existe déjà et n'est pas vide.",
      {
        name: { type: "string", description: "Nom du dossier du projet (lettres, chiffres, - _ .)." },
        files: {
          type: "array",
          description: "Fichiers à créer, chemins relatifs au dossier du projet.",
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
          },
        },
      },
      ["name", "files"],
    ),
    async run(args, ctx) {
      const name = sanitizeProjectName(str(args, "name"));
      const files = args.files;
      if (!Array.isArray(files) || files.length === 0) throw new Error("Aucun fichier fourni.");
      const projectDir = ctx.scope.resolve(path.join(ctx.projectsRoot, name));
      if (exists(projectDir) && fs.readdirSync(projectDir).length > 0) {
        throw new Error(`Le dossier ${projectDir} existe déjà et n'est pas vide.`);
      }
      const planned = files.map((f) => {
        const rel = typeof f?.path === "string" ? f.path : "";
        if (!rel || path.isAbsolute(rel)) throw new Error(`Chemin de fichier invalide : « ${rel} »`);
        const abs = ctx.scope.resolve(path.join(projectDir, rel));
        if (path.relative(projectDir, abs).startsWith("..")) throw new Error(`Chemin hors projet : « ${rel} »`);
        return { abs, rel, content: typeof f.content === "string" ? f.content : "" };
      });
      const ok = await ctx.host.confirm({
        title: `Créer le projet « ${name} » ?`,
        detail: `${projectDir}\n${planned.map((p) => `+ ${p.rel}`).join("\n")}`,
        risk: "confirm",
      });
      if (!ok) throw new Error("Refusé par l'utilisateur.");
      for (const p of planned) {
        fs.mkdirSync(path.dirname(p.abs), { recursive: true });
        fs.writeFileSync(p.abs, p.content, "utf8");
      }
      return `Projet créé dans ${projectDir} (${planned.length} fichier(s)).`;
    },
  },
};

export const TOOL_SCHEMAS: ToolSchema[] = Object.values(tools).map((t) => t.schema);
export const TOOL_NAMES = Object.keys(tools);

export async function runTool(name: string, args: Args, ctx: ToolContext): Promise<ToolResult> {
  const tool = tools[name];
  if (!tool) return { ok: false, output: `Outil inconnu : ${name}` };
  try {
    return { ok: true, output: await tool.run(args, ctx) };
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}
