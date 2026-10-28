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
    else if (last.role === "tool") msg = { role: "assistant", content: last.content.includes("Réponse de") ? `## Tableau créé\n\nFormat choisi : **${last.content.split(" : ").pop()}**\n\n- fichier \`stats.csv\`\n- 3 lignes\n\n| Nom | Valeur |\n|---|---|\n| a | 1 |` : "Terminé : " + last.content.slice(0, 60) };
    else if (last.content.includes("question")) msg = { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "ask_user", arguments: JSON.stringify({ question: "Quel **format** voulez-vous ?", choices: ["CSV", "Excel"] }) } }] };
    else if (last.content.includes("shell")) msg = { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "run_shell", arguments: JSON.stringify({ command: "echo hello-from-shell" }) } }] };
    else msg = { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "list_files", arguments: JSON.stringify({ path: allowed }) } }] };
    res.setHeader("content-type", "application/json");
    setTimeout(() => res.end(JSON.stringify({ choices: [{ message: msg }] })), 700);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ provider: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, model: "mock", allowedRoots: [allowed], projectsRoot: path.join(allowed, "Projects"), shortcut: "Alt+Space", dictationShortcut: "Alt+Shift+Space" }));

const app = spawn("xvfb-run", ["-a", "node_modules/electron/dist/electron", ".", "--no-sandbox", `--user-data-dir=${userData}`, "--remote-debugging-port=9333", "--show", "--e2e"], { stdio: ["ignore", "pipe", "pipe"] });
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

const type = (text, meta = false) => ev(`(() => { const p = document.getElementById('prompt'); p.value = ${JSON.stringify(text)}; p.dispatchEvent(new Event('input')); p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: ${meta}, bubbles: true })); })()`);
const text = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.innerText).join('\\n')`);
const click = (sel, label) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].find(b => ${JSON.stringify(label)} === '' || b.textContent.includes(${JSON.stringify(label)})).click()`);

check("mode compact au départ", await ev("document.getElementById('card').classList.contains('compact')"));
await shot("0-compact");

// 1. prompt agent -> list_files
await type("liste mes fichiers");
await sleep(1300);
const prog = await ev("document.getElementById('progress').hidden ? '' : document.getElementById('progress-text').innerText");
check("jauge de progression visible (temps + étape)", /\d:\d\d/.test(prog) && prog.includes("1 action"), JSON.stringify(prog));
check("mode conversation actif", await ev("!document.getElementById('card').classList.contains('compact')"));
await sleep(1500);
let out = await text("#messages");
check("agent: message utilisateur, étape et réponse", out.includes("liste mes fichiers") && out.includes("Liste le dossier") && out.includes("Terminé"), JSON.stringify(out.slice(0, 160)));
await shot("1-agent");

// 2. prompt shell -> confirmation inline
await type("lance un shell");
await sleep(2000);
check("progression en pause pendant la confirmation", (await ev("document.getElementById('progress-text').innerText")).includes("En attente de votre confirmation"));
check("confirmation shell affichée dans la conversation", await ev("document.querySelector('.card.confirm pre.detail')?.innerText.includes('echo hello-from-shell') === true"));
await shot("2-confirm");
await click("[data-role=confirm-yes]", "");
await sleep(1500);
out = await text("#messages");
check("shell exécuté après confirmation", out.includes("hello-from-shell") && out.includes("Autorisé"), JSON.stringify(out.slice(-160)));

// 3. question de l'agent : boutons
await type("j'ai une question");
await sleep(1800);
check("carte de question avec boutons", await ev("document.querySelectorAll('.card.ask .choice').length === 2 && !!document.querySelector('.card.ask strong')"));
check("progression en attente de réponse", (await ev("document.getElementById('progress-text').innerText")).includes("En attente de votre réponse"));
check("saisie libre possible pendant la question", await ev("!document.getElementById('prompt').disabled && document.getElementById('prompt').placeholder === 'Votre réponse…'"));
await shot("3-ask");
await click(".card.ask .choice", "Excel");
await sleep(1800);
out = await text("#messages");
check("réponse par bouton transmise à l'agent", out.includes("Excel") && out.includes("Réponse") === false && out.includes("Tableau créé"), JSON.stringify(out.slice(-200)));
check("réponse formatée en Markdown (titre, liste, tableau, code)", await ev("!!document.querySelector('.bubble.md h3') && document.querySelectorAll('.bubble.md li').length >= 2 && !!document.querySelector('.bubble.md table td') && !!document.querySelector('.bubble.md code')"));
await shot("3b-markdown");

// 3c. question : réponse par texte libre
await type("autre question");
await sleep(1800);
await type("Format ODS");
await sleep(1800);
out = await text("#messages");
check("réponse par texte libre transmise", out.includes("Format ODS") && out.includes("Tableau créé"), JSON.stringify(out.slice(-120)));

// 4. historique
const hist = await ev("window.launcher.getState().then(s => s.history)");
check("historique enregistré", hist.length === 4 && hist[1] === "lance un shell", JSON.stringify(hist));

// 5. mode dossier : plan par type, apply, undo
const plan = await ev(`window.launcher.planFolder(${JSON.stringify(allowed)}, '', 'type')`);
check("plan par type (dry-run)", plan.ok && plan.plan.moves.length === 3 && fs.existsSync(path.join(allowed, "a.png")));
await ev(`(async()=>{ const r = await window.launcher.planFolder(${JSON.stringify(allowed)}, 'range', 'prompt'); window.__p = r; })()`);
const p2 = await ev("window.__p");
check("plan via LLM (mock)", p2.ok && p2.plan.moves[0].toRel === "Pics/a.png");

await ev(`window.__e2e.setFolder(${JSON.stringify(allowed)}); 0`);
await type("", true);
await sleep(1000);
check("aperçu du plan dans la conversation", await ev("document.querySelector('.plan')?.innerText.includes('Images/a.png') === true") && fs.existsSync(path.join(allowed, "a.png")));
await shot("4-plan");
await click(".plan button", "Appliquer");
await sleep(800);
check("confirmation avant application", await ev("!!document.querySelector('[data-role=confirm-no]:not([disabled])') && !!document.querySelector('.card.confirm:not(.done)')") && fs.existsSync(path.join(allowed, "a.png")));
await click("[data-role=confirm-no]", "");
await sleep(500);
check("refus => rien ne bouge", fs.existsSync(path.join(allowed, "a.png")) && !fs.existsSync(path.join(allowed, "Images")));
await click(".plan button", "Appliquer");
await sleep(800);
await ev("document.querySelectorAll('[data-role=confirm-yes]')[document.querySelectorAll('[data-role=confirm-yes]').length - 1].click(); 0");
await sleep(800);
check("fichiers rangés après confirmation", fs.existsSync(path.join(allowed, "Images/a.png")) && !fs.existsSync(path.join(allowed, "a.png")));
await shot("4b-applied");
await click(".plan button", "Annuler ce rangement");
await sleep(800);
check("annulation du rangement", fs.existsSync(path.join(allowed, "a.png")) && !fs.existsSync(path.join(allowed, "Images")));

// 6. nouvelle conversation + réglages
await click("#new-btn", "");
await sleep(500);
check("nouvelle conversation : retour au mode compact", await ev("document.getElementById('card').classList.contains('compact') && document.getElementById('messages').childElementCount === 0"));
await ev("document.getElementById('settings-btn').click(); 0");
await sleep(500);
check("panneau réglages", await ev("!document.getElementById('settings').hidden"));
await shot("5-settings");

const failed = results.filter(([, ok]) => !ok);
console.log(failed.length ? "ÉCHECS: " + failed.length : "TOUT OK");
console.log("fichiers après e2e:", fs.readdirSync(allowed));
app.kill("SIGTERM"); server.close();
setTimeout(() => process.exit(failed.length ? 1 : 0), 500);
