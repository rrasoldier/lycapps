// Mode développement : `npm run dev`
//  - recompile en continu le processus principal et l'interface (tsc --watch) ;
//  - recopie index.html / styles.css quand ils changent ;
//  - l'interface se recharge toute seule à chaque changement du renderer ;
//  - Electron est relancé automatiquement à chaque changement du processus principal.
// Quittez AlphaCris (⌘Q) avant : une seule instance peut tourner à la fois.
// Les arguments après `--` sont transmis à Electron (ex. npm run dev -- --user-data-dir=/tmp/alphacris-dev).
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, watch } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const require = createRequire(import.meta.url);
const tsc = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
const electronBin = require("electron");

const copyAssets = () => {
  mkdirSync("dist/renderer", { recursive: true });
  for (const f of ["index.html", "styles.css"]) copyFileSync(`src/renderer/${f}`, `dist/renderer/${f}`);
};

const children = new Set();
function run(cmd, args) {
  const c = spawn(cmd, args, { cwd: root, stdio: "inherit" });
  children.add(c);
  c.on("exit", () => children.delete(c));
  return c;
}

// Premier build complet, puis surveillance.
await new Promise((resolve, reject) => {
  const b = spawn(tsc, ["-p", "tsconfig.main.json"], { cwd: root, stdio: "inherit" });
  b.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("La compilation du processus principal a échoué."))));
}).then(() =>
  new Promise((resolve, reject) => {
    const b = spawn(tsc, ["-p", "tsconfig.renderer.json"], { cwd: root, stdio: "inherit" });
    b.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("La compilation de l'interface a échoué."))));
  }),
);
copyAssets();
run(tsc, ["-p", "tsconfig.main.json", "--watch", "--preserveWatchOutput"]);
run(tsc, ["-p", "tsconfig.renderer.json", "--watch", "--preserveWatchOutput"]);

let timerAssets;
watch("src/renderer", { recursive: true }, (_e, name) => {
  if (!name || !/\.(html|css)$/.test(String(name))) return;
  clearTimeout(timerAssets);
  timerAssets = setTimeout(copyAssets, 100);
});

let electron = null;
let restarting = false;
let stopping = false;
const passthrough = process.argv.slice(2);
function launch(extra = []) {
  electron = spawn(electronBin, [".", "--dev", "--show", ...passthrough, ...extra], { cwd: root, stdio: "inherit" });
  electron.on("exit", (code) => {
    electron = null;
    if (restarting) {
      restarting = false;
      launch(["--reloaded"]);
    } else if (!stopping) {
      shutdown(code ?? 0);
    }
  });
}

function shutdown(code = 0) {
  stopping = true;
  for (const c of children) c.kill();
  electron?.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

let timerMain;
for (const dir of ["dist/main", "dist/core", "dist/preload"]) {
  if (!existsSync(dir)) continue;
  watch(dir, { recursive: true }, (_e, name) => {
    if (!name || !String(name).endsWith(".js")) return;
    clearTimeout(timerMain);
    timerMain = setTimeout(() => {
      if (!electron || restarting) return;
      console.log("[dev] processus principal modifié : relance d'AlphaCris…");
      restarting = true;
      electron.kill();
    }, 400);
  });
}

console.log("[dev] AlphaCris en mode développement : modifiez src/ et l'interface se recharge ; Ctrl+C pour arrêter.");
launch();
