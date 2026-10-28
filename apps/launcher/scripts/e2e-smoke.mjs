// Test de fumée Linux : lance la vraie app Electron sous Xvfb avec un faux serveur LLM local
// et pilote l'UI via le protocole DevTools. Usage : npm run build && node scripts/e2e-smoke.mjs
// (nécessite xvfb-run ; captures dans $E2E_OUT, par défaut le dossier temporaire).
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const outDir = process.env.E2E_OUT || os.tmpdir();
fs.mkdirSync(outDir, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-e2e-"));
const allowed = path.join(work, "files");
fs.mkdirSync(allowed);
for (const n of ["a.png", "b.pdf", "c.zip"]) fs.writeFileSync(path.join(allowed, n), n);
const userData = path.join(work, "ud");
fs.mkdirSync(userData);

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const b = JSON.parse(body);
    const last = b.messages.at(-1);
    let msg;
    if (b.response_format) msg = { role: "assistant", content: JSON.stringify({ summary: "Mock: images à part", assignments: [{ name: "a.png", dest: "Pics" }] }) };
    else if (last.role === "tool") msg = { role: "assistant", content: "Terminé : " + last.content.slice(0, 60) };
    else if (last.content.includes("shell")) msg = { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "run_shell", arguments: JSON.stringify({ command: "echo hello-from-shell" }) } }] };
    else msg = { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "list_files", arguments: JSON.stringify({ path: allowed }) } }] };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: msg }] }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ provider: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, model: "mock", allowedRoots: [allowed], projectsRoot: path.join(allowed, "Projects"), shortcut: "Alt+Space", dictationShortcut: "Alt+Shift+Space" }));

const app = spawn("xvfb-run", ["-a", "node_modules/electron/dist/electron", ".", "--no-sandbox", `--user-data-dir=${userData}`, "--remote-debugging-port=9333", "--show"], { stdio: ["ignore", "pipe", "pipe"] });
app.stdout.on("data", (d) => process.stdout.write("[app] " + d));
app.stderr.on("data", (d) => { const s = String(d); if (!/dbus|gpu|GLib|libva|Fontconfig/i.test(s)) process.stdout.write("[app!] " + s); });

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9333/json")).json();
      const t = list.find((x) => x.type === "page");
      if (t) return t;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no target");
}
const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.result.data, "base64")); };

const results = [];
const check = (name, ok, extra = "") => { results.push([name, ok]); console.log(ok ? "PASS" : "FAIL", name, extra); };

await sleep(1500);
check("renderer chargé (api exposée)", await ev("typeof window.launcher.runPrompt === 'function'"));
check("état disponible", await ev("window.launcher.getState().then(s => s.settings.provider)") === "custom");

// 1. prompt agent -> list_files
await ev(`document.getElementById('prompt').value='liste mes fichiers'; document.getElementById('prompt').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); 0`);
await sleep(1500);
let out = await ev("document.getElementById('output').innerText");
check("agent: appel d'outil + réponse", out.includes("list_files") && out.includes("Terminé"), JSON.stringify(out.slice(0, 120)));
await shot("1-agent");

// 2. prompt shell -> confirmation
await ev(`document.getElementById('prompt').value='lance un shell'; document.getElementById('prompt').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); 0`);
await sleep(1500);
check("confirmation shell affichée", await ev("!document.getElementById('confirm').hidden && document.getElementById('confirm-detail').innerText.includes('echo hello-from-shell')"));
await shot("2-confirm");
await ev("document.getElementById('confirm-yes').click(); 0");
await sleep(1500);
out = await ev("document.getElementById('output').innerText");
check("shell exécuté après confirmation", out.includes("hello-from-shell"), JSON.stringify(out.slice(-120)));

// 3. historique
const hist = await ev("window.launcher.getState().then(s => s.history)");
check("historique enregistré", hist.length === 2 && hist[1] === "lance un shell", JSON.stringify(hist));

// 4. mode dossier: plan par type, apply, undo
const plan = await ev(`window.launcher.planFolder(${JSON.stringify(allowed)}, '', 'type')`);
check("plan par type (dry-run)", plan.ok && plan.plan.moves.length === 3 && fs.existsSync(path.join(allowed, "a.png")));
await ev(`(async()=>{ const r = await window.launcher.planFolder(${JSON.stringify(allowed)}, 'range', 'prompt'); window.__p = r; })()`);
const p2 = await ev("window.__p");
check("plan via LLM (mock)", p2.ok && p2.plan.moves[0].toRel === "Pics/a.png");

// UI folder mode with preview
await ev(`setFolder(${JSON.stringify(allowed)}); 0`);
await ev(`document.getElementById('prompt').value=''; document.getElementById('prompt').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true})); 0`);
await sleep(1000);
check("aperçu du plan dans l'UI", await ev("document.getElementById('plan').innerText.includes('Images/a.png')") && fs.existsSync(path.join(allowed, "a.png")));
await shot("3-plan");
await ev("[...document.querySelectorAll('#plan button')].find(b=>b.textContent.startsWith('Appliquer')).click(); 0");
await sleep(800);
check("confirmation avant application", await ev("!document.getElementById('confirm').hidden") && fs.existsSync(path.join(allowed, "a.png")));
await ev("document.getElementById('confirm-no').click(); 0");
await sleep(500);
check("refus => rien ne bouge", fs.existsSync(path.join(allowed, "a.png")) && !fs.existsSync(path.join(allowed, "Images")));
await ev("[...document.querySelectorAll('#plan button')].find(b=>b.textContent.startsWith('Appliquer')).click(); 0");
await sleep(800);
await ev("document.getElementById('confirm-yes').click(); 0");
await sleep(800);
check("fichiers rangés après confirmation", fs.existsSync(path.join(allowed, "Images/a.png")) && !fs.existsSync(path.join(allowed, "a.png")));
await shot("3b-applied");
await ev("[...document.querySelectorAll('#output button')].find(b=>b.textContent.startsWith('Annuler ce rangement')).click(); 0");
await sleep(800);
check("annulation du rangement", fs.existsSync(path.join(allowed, "a.png")) && !fs.existsSync(path.join(allowed, "Images")));

// settings panel
await ev("document.getElementById('settings-btn').click(); 0");
await sleep(500);
check("panneau réglages", await ev("!document.getElementById('settings').hidden"));
await shot("4-settings");

const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? "ÉCHECS: " + failed.length : "TOUT OK");
console.log("fichiers après e2e:", fs.readdirSync(allowed));
app.kill("SIGTERM"); server.close();
setTimeout(() => process.exit(failed.length ? 1 : 0), 500);
