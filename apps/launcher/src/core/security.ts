import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

export function expandHome(p: string, home = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/** Résout les liens symboliques sur le plus long préfixe existant du chemin. */
export function realpathLoose(p: string): string {
  const abs = path.resolve(p);
  const tail: string[] = [];
  let current = abs;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

export function isInside(child: string, root: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface ScopeOptions {
  allowedRoots: string[];
  home?: string;
}

export class Scope {
  readonly roots: string[];
  private readonly home: string;

  constructor(opts: ScopeOptions) {
    this.home = opts.home ?? os.homedir();
    this.roots = opts.allowedRoots
      .map((r) => realpathLoose(expandHome(r, this.home)))
      .filter((r) => r !== path.parse(r).root);
  }

  /**
   * Retourne le chemin absolu canonique (liens symboliques résolus) ou lève
   * ScopeError s'il sort du périmètre autorisé. Les chemins relatifs sont
   * résolus depuis `base` (par défaut la première racine autorisée).
   */
  resolve(input: string, base?: string): string {
    if (!input || input.includes("\0")) throw new ScopeError("Chemin invalide.");
    const expanded = expandHome(input, this.home);
    const baseDir = base ?? this.roots[0];
    if (!path.isAbsolute(expanded) && !baseDir) {
      throw new ScopeError("Aucun dossier autorisé n'est configuré.");
    }
    const abs = path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
    const real = realpathLoose(abs);
    if (!this.roots.some((r) => isInside(real, r))) {
      throw new ScopeError(
        `Accès refusé : « ${input} » est en dehors des dossiers autorisés (${this.roots.join(", ") || "aucun"}).`,
      );
    }
    return real;
  }

  contains(input: string): boolean {
    try {
      this.resolve(input);
      return true;
    } catch {
      return false;
    }
  }
}

export type ShellRisk = "normal" | "danger";

const DANGEROUS: Array<[RegExp, string]> = [
  [/\brm\b[^|;&]*\s-[a-zA-Z]*[rf]/, "suppression récursive/forcée (rm -r/-f)"],
  [/\bsudo\b/, "élévation de privilèges (sudo)"],
  [/\bmkfs\b|\bdd\b\s+.*\bof=/, "écriture disque bas niveau"],
  [/(curl|wget)[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, "exécution de script distant (curl | sh)"],
  [/>\s*\/dev\/(sd|disk|nvme)/, "écriture sur un périphérique"],
  [/\bchmod\b\s+-R|\bchown\b\s+-R/, "changement récursif de permissions"],
  [/\b(shutdown|reboot|halt)\b/, "arrêt/redémarrage"],
  [/\bdiskutil\b\s+(erase|partition|apfs\s+delete)/, "effacement de disque"],
  [/:\(\)\s*\{.*\};\s*:/, "fork bomb"],
  [/\bkillall\b|\bpkill\b/, "arrêt de processus"],
  [/\blaunchctl\b|\bdefaults\s+write\b|\bcsrutil\b/, "modification de la configuration système"],
];

export function classifyShellCommand(command: string): { risk: ShellRisk; reasons: string[] } {
  const reasons = DANGEROUS.filter(([re]) => re.test(command)).map(([, why]) => why);
  return { risk: reasons.length ? "danger" : "normal", reasons };
}

export function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return ["http:", "https:", "mailto:"].includes(u.protocol);
  } catch {
    return false;
  }
}

export function isSafeAppName(name: string): boolean {
  return /^[\p{L}\p{N} ._+&'()-]{1,80}$/u.test(name) && !name.includes("..");
}
