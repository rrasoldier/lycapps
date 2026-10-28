import { execFile } from "node:child_process";
import * as path from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number }) => Promise<RunResult>;

/**
 * Exécute une commande. Avec `loginShell`, passe par un shell de connexion : une app lancée depuis le
 * Finder n'hérite pas du PATH du Terminal (Homebrew, nvm…), donc `git`/`npm` y seraient introuvables.
 */
export function makeRunner(opts: { loginShell?: string } = {}): Runner {
  return (cmd, args, { cwd, timeoutMs = 120_000 }) =>
    new Promise((resolve) => {
      const [file, fileArgs] = opts.loginShell ? [opts.loginShell, ["-l", "-c", 'exec "$@"', "sh", cmd, ...args]] : [cmd, args];
      execFile(file, fileArgs, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
        const errCode: unknown = err ? (err as { code?: unknown }).code : 0;
        const code = typeof errCode === "number" ? errCode : err ? 1 : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) + (err && !stderr ? err.message : "") });
      });
    });
}

export type UpdateStatus =
  | { state: "unavailable"; reason: string }
  | { state: "up-to-date"; version: string }
  | { state: "available"; behind: number; version: string; subjects: string[] };

export interface UpdateResult {
  changed: boolean;
  from: string;
  to: string;
  installedDependencies: boolean;
}

const short = (s: string) => s.trim().split("\n").slice(-6).join("\n");

/**
 * Mise à jour « depuis le dépôt git » : l'app tourne depuis une copie du code (clone du dépôt).
 * Vérifier = `git fetch` ; mettre à jour = `git pull --ff-only`, `npm install` si les dépendances ont
 * changé, `npm run build`. Rien n'est jamais forcé : une copie modifiée localement n'est pas écrasée.
 */
export class Updater {
  private repoCache: string | null | undefined;

  constructor(
    private readonly appDir: string,
    private readonly run: Runner,
  ) {}

  private async git(args: string[], timeoutMs?: number): Promise<RunResult> {
    return this.run("git", args, { cwd: this.appDir, timeoutMs });
  }

  private async repoRoot(): Promise<string | null> {
    if (this.repoCache !== undefined) return this.repoCache;
    const r = await this.git(["rev-parse", "--show-toplevel"], 15_000).catch(() => null);
    this.repoCache = r && r.code === 0 ? r.stdout.trim() : null;
    return this.repoCache;
  }

  private async head(): Promise<string> {
    const r = await this.git(["rev-parse", "--short", "HEAD"]);
    return r.code === 0 ? r.stdout.trim() : "inconnue";
  }

  async check(): Promise<UpdateStatus> {
    if (!(await this.repoRoot())) {
      return { state: "unavailable", reason: "L'application n'est pas lancée depuis un dépôt git : mise à jour manuelle (nouvelle version à réinstaller)." };
    }
    const upstream = await this.git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    if (upstream.code !== 0) {
      return { state: "unavailable", reason: "La branche locale ne suit aucune branche distante (git branch --set-upstream-to)." };
    }
    const fetched = await this.git(["fetch", "--quiet"], 45_000);
    if (fetched.code !== 0) {
      return { state: "unavailable", reason: `Impossible de contacter le dépôt (réseau, accès GitHub ou branche supprimée) : ${short(fetched.stderr)}` };
    }
    const version = await this.head();
    const count = await this.git(["rev-list", "--count", "HEAD..@{u}"]);
    const behind = count.code === 0 ? Number.parseInt(count.stdout, 10) || 0 : 0;
    if (behind === 0) return { state: "up-to-date", version };
    const log = await this.git(["log", "--format=%s", "-n", "5", "HEAD..@{u}"]);
    return { state: "available", behind, version, subjects: log.stdout.split("\n").map((l) => l.trim()).filter(Boolean) };
  }

  async apply(onStep: (text: string) => void = () => {}): Promise<UpdateResult> {
    if (!(await this.repoRoot())) throw new Error("Mise à jour impossible : l'application n'est pas lancée depuis un dépôt git.");
    const from = (await this.git(["rev-parse", "HEAD"])).stdout.trim();

    onStep("Téléchargement des nouveautés…");
    const pull = await this.git(["pull", "--ff-only", "--quiet"], 120_000);
    if (pull.code !== 0) {
      throw new Error(`git pull a échoué (modifications locales ou historique divergent ?) :\n${short(pull.stderr || pull.stdout)}`);
    }
    const to = (await this.git(["rev-parse", "HEAD"])).stdout.trim();
    if (from === to) return { changed: false, from, to, installedDependencies: false };

    try {
      const changedFiles = (await this.git(["diff", "--name-only", from, to, "--", "package.json", "package-lock.json"])).stdout.split("\n").map((l) => path.basename(l.trim()));
      const needsInstall = changedFiles.some((f) => f === "package.json" || f === "package-lock.json");
      if (needsInstall) {
        onStep("Installation des dépendances (npm install)…");
        const install = await this.run("npm", ["install", "--no-audit", "--no-fund"], { cwd: this.appDir, timeoutMs: 600_000 });
        if (install.code !== 0) throw new Error(`npm install a échoué :\n${short(install.stderr || install.stdout)}`);
      }
      onStep("Compilation (npm run build)…");
      const build = await this.run("npm", ["run", "build"], { cwd: this.appDir, timeoutMs: 300_000 });
      if (build.code !== 0) throw new Error(`La compilation a échoué :\n${short(build.stdout || build.stderr)}`);
      return { changed: true, from, to, installedDependencies: needsInstall };
    } catch (err) {
      // `--keep` ne touche pas aux modifications locales : on revient simplement à la version précédente.
      const back = await this.git(["reset", "--keep", from]);
      if (back.code === 0) await this.run("npm", ["run", "build"], { cwd: this.appDir, timeoutMs: 300_000 }).catch(() => undefined);
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`${detail}\n\nL'ancienne version a été conservée.`);
    }
  }
}
