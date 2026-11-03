// Test du bouton « Recharger » avec la vraie app : un dépôt git temporaire (distant + copie de l'utilisatrice),
// un nouveau commit publié, un clic sur « Recharger » -> git pull, compilation, relance, nouvelle version affichée,
// sans second « bonjour ». Usage : npm run build && node scripts/e2e-reload.mjs   (nécessite Xvfb et git)
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, stdio: "pipe" }).toString().trim();
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "launcher-reload-")));
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(ok ? "PASS" : "FAIL", name, extra);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const remote = path.join(tmp, "remote.git");
git(tmp, "init", "--bare", "-b", "main", remote);
const dev = path.join(tmp, "dev");
git(tmp, "clone", "-q", remote, dev);
const devApp = path.join(dev, "apps/launcher");
fs.mkdirSync(devApp, { recursive: true });
for (const f of ["package.json", "package-lock.json", "tsconfig.base.json", "tsconfig.main.json", "tsconfig.renderer.json"]) fs.copyFileSync(path.join(here, f), path.join(devApp, f));
for (const d of ["src", "scripts", "resources"]) fs.cpSync(path.join(here, d), path.join(devApp, d), { recursive: true });
git(dev, "add", "-A");
git(dev, "commit", "-qm", "v1");
git(dev, "push", "-q", "-u", "origin", "main");
const user = path.join(tmp, "user");
git(tmp, "clone", "-q", remote, user);
const appDir = path.join(user, "apps/launcher");
fs.symlinkSync(path.join(here, "node_modules"), path.join(appDir, "node_modules"));
execFileSync("npm", ["run", "build"], { cwd: appDir, stdio: "pipe" });

const htmlPath = "src/renderer/index.html";
fs.writeFileSync(path.join(devApp, htmlPath), fs.readFileSync(path.join(devApp, htmlPath), "utf8").replace('<span>AlphaCris</span>', "<span>AlphaCris v2</span>"));
git(dev, "add", "-A");
git(dev, "commit", "-qm", "v2");
git(dev, "push", "-q");

const userData = path.join(tmp, "ud");
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ provider: "custom", baseUrl: "http://127.0.0.1:1/v1", model: "mock", allowedRoots: [tmp] }));
const sayLog = path.join(tmp, "say.log");
const sayBin = path.join(tmp, "say");
fs.writeFileSync(sayBin, `#!/bin/sh\nif [ "$1" = "-v" ] && [ "$2" = "?" ]; then exit 0; fi\necho "$*" >> "${sayLog}"\n`, { mode: 0o755 });

const port = 9355;
// Xvfb est lancé à part : avec xvfb-run, le serveur X s'arrête avec le premier processus, avant la relance.
const display = ":97";
const xvfb = spawn("Xvfb", [display, "-screen", "0", "1280x900x24"], { stdio: "ignore" });
await sleep(1000);
const app = spawn(path.join(here, "node_modules/electron/dist/electron"), [".", "--no-sandbox", `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`, "--show", "--e2e"], {
  cwd: appDir,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DISPLAY: display, LAUNCHER_SAY: sayBin, LAUNCHER_GREET_E2E: "1" },
});
app.stdout.on("data", (d) => process.stdout.write("[app] " + d));
app.stderr.on("data", (d) => {
  const s = String(d);
  if (!/dbus|gpu|GLib|libva|Fontconfig/i.test(s)) process.stdout.write("[app!] " + s);
});

async function connect(timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
        let id = 0;
        const pending = new Map();
        ws.onmessage = (m) => {
          const d = JSON.parse(m.data);
          if (d.id && pending.has(d.id)) (pending.get(d.id)(d), pending.delete(d.id));
        };
        const ev = (expr) =>
          new Promise((resolve) => {
            const i = ++id;
            pending.set(i, (d) => resolve(d.result?.result?.value));
            ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
          });
        return { ev, close: () => ws.close() };
      }
    } catch {}
    await sleep(500);
  }
  throw new Error("fenêtre introuvable");
}

try {
  let page = await connect();
  await sleep(1500);
  check("version 1 affichée au départ", (await page.ev("document.querySelector('.brand').textContent")).trim() === "AlphaCris");
  check("le bouton Recharger est visible", await page.ev("Boolean(document.getElementById('reload-btn')) && !document.getElementById('reload-btn').disabled"));
  const before = await page.ev("window.launcher.getState().then(() => 1)");
  check("le premier lancement dit bonjour", await (async () => { for (let i = 0; i < 20; i++) { if (fs.existsSync(sayLog) && fs.readFileSync(sayLog, "utf8").includes("Criss")) return true; await sleep(250); } return false; })(), String(before));
  await page.ev("document.getElementById('reload-btn').click(); 0");
  await sleep(800);
  check("un bandeau indique le rechargement", await page.ev("!document.getElementById('reload-banner').hidden"));
  page.close();
  // L'ancien processus s'arrête, un nouveau démarre après compilation.
  await sleep(2000);
  page = await connect(120000);
  let brand = "";
  for (let i = 0; i < 40; i++) {
    brand = ((await page.ev("document.querySelector('.brand')?.textContent")) ?? "").trim();
    if (brand.includes("v2")) break;
    await sleep(500);
  }
  check("la nouvelle version (v2) est affichée après relance", brand === "AlphaCris v2", brand);
  check("le dépôt local est sur le dernier commit", git(appDir, "log", "--format=%s", "-n", "1") === "v2");
  check("la version compilée contient la nouveauté", fs.readFileSync(path.join(appDir, "dist/renderer/index.html"), "utf8").includes("AlphaCris v2"));
  await sleep(2500);
  check("pas de second bonjour après le rechargement", fs.readFileSync(sayLog, "utf8").split("Criss").length === 2);
  check("pas de bandeau d'erreur", await page.ev("document.getElementById('reload-banner').classList.contains('error') === false"));
  page.close();
} catch (err) {
  check("scénario sans exception", false, String(err));
} finally {
  app.kill("SIGKILL");
  spawn("pkill", ["-f", `remote-debugging-port=${port}`]);
  xvfb.kill("SIGKILL");
  fs.rmSync(tmp, { recursive: true, force: true });
}
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? `ÉCHECS : ${failed.length}` : "TOUT OK");
process.exit(failed.length ? 1 : 0);
