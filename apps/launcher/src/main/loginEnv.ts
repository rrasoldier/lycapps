import { spawnSync } from "node:child_process";

const BEGIN = "__ALPHACRIS_ENV_BEGIN__";
const END = "__ALPHACRIS_ENV_END__";
const SKIP = new Set(["ELECTRON_RUN_AS_NODE", "_", "PWD", "OLDPWD", "SHLVL"]);

/** Extrait l'environnement JSON imprimé entre deux repères (les fichiers de démarrage du shell peuvent écrire n'importe quoi avant). */
export function parseLoginEnv(output: string): Record<string, string> | null {
  const start = output.indexOf(BEGIN);
  const stop = output.lastIndexOf(END);
  if (start < 0 || stop < start) return null;
  try {
    const parsed = JSON.parse(output.slice(start + BEGIN.length, stop)) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  } catch {
    return null;
  }
}

/** Variables du shell de connexion à ajouter à l'environnement courant : ce qui existe déjà n'est jamais écrasé, PATH est complété. */
export function mergeLoginEnv(current: NodeJS.ProcessEnv, login: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(login)) {
    if (SKIP.has(key)) continue;
    if (key === "PATH") {
      const have = (current.PATH ?? "").split(":").filter(Boolean);
      const extra = value.split(":").filter((p) => p && !have.includes(p));
      if (extra.length) out.PATH = [...have, ...extra].join(":");
    } else if (current[key] === undefined) out[key] = value;
  }
  return out;
}

/**
 * Une app lancée depuis le Finder n'a pas l'environnement du Terminal (ni `~/.zprofile` : PATH Homebrew,
 * CURSOR_API_KEY…). On le relit une fois via un shell de connexion, comme le faisait l'ancien lanceur en script.
 */
export function importLoginEnv(execPath: string, shell = "/bin/zsh"): boolean {
  const script = `printf '%s' '${BEGIN}'; exec "$0" -e 'process.stdout.write(JSON.stringify(process.env))'`;
  const r = spawnSync(shell, ["-l", "-c", script, execPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 6000,
  });
  const env = parseLoginEnv(`${r.stdout ?? ""}${END}`);
  if (!env) return false;
  Object.assign(process.env, mergeLoginEnv(process.env, env));
  return true;
}
