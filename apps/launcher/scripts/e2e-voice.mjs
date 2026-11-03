// Test de bout en bout de la conversation vocale (Linux, Xvfb, vraie app Electron) :
//  - micro simulé par Chromium (fichier WAV synthétisé avec espeak-ng, avec des silences) ;
//  - Whisper simulé (un script qui rend les phrases attendues, dans l'ordre) ;
//  - `say` simulé (journalise ce que l'assistant dirait) ;
//  - faux serveur LLM local.
// Usage : npm run build && node scripts/e2e-voice.mjs   (nécessite xvfb-run et espeak-ng)
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const outDir = process.env.E2E_OUT || os.tmpdir();
fs.mkdirSync(outDir, { recursive: true });
const RATE = 48000;
const ESPEAK_RATE = 22050;

function speech(text) {
  const tmp = path.join(os.tmpdir(), `espeak-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  execFileSync("espeak-ng", ["-v", "fr", "-s", "150", "-w", tmp, text]);
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  let pos = 12;
  while (pos < buf.length - 8) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "data") {
      const src = new Int16Array(buf.buffer.slice(buf.byteOffset + pos + 8, buf.byteOffset + pos + 8 + Math.min(size, buf.length - pos - 8)));
      const out = new Int16Array(Math.round((src.length * RATE) / ESPEAK_RATE));
      for (let i = 0; i < out.length; i++) {
        const x = (i * ESPEAK_RATE) / RATE;
        const i0 = Math.floor(x);
        out[i] = Math.round(src[i0] * (1 - (x - i0)) + (src[Math.min(i0 + 1, src.length - 1)] ?? 0) * (x - i0));
      }
      return out;
    }
    pos += 8 + size;
  }
  throw new Error("WAV espeak illisible");
}

function timeline(parts) {
  const chunks = parts.map((p) => (typeof p === "number" ? new Int16Array(Math.round(p * RATE)) : speech(p)));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const data = new Int16Array(total);
  let o = 0;
  for (const c of chunks) {
    data.set(c, o);
    o += c.length;
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length * 2, 40);
  return Buffer.concat([header, Buffer.from(data.buffer)]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => {
  results.push([name, ok]);
  console.log(ok ? "PASS" : "FAIL", name, extra);
};

async function scenario(name, { settings, audio, queue, port: debugPort, run, real = false }) {
  console.log(`\n== ${name}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-e2e-voice-"));
  const allowed = path.join(work, "files");
  fs.mkdirSync(allowed);
  fs.writeFileSync(path.join(allowed, "a.txt"), "a");
  const userData = path.join(work, "ud");
  fs.mkdirSync(userData);

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const b = JSON.parse(body);
      const last = b.messages.at(-1);
      let msg;
      if (last.role === "tool") msg = { role: "assistant", content: "Terminé, la commande a été exécutée." };
      else if (last.content.includes("commande shell")) msg = { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "run_shell", arguments: JSON.stringify({ command: "echo hello-voice" }) } }] };
      else msg = { role: "assistant", content: "J'ai trouvé un fichier : a.txt." };
      res.setHeader("content-type", "application/json");
      setTimeout(() => res.end(JSON.stringify({ choices: [{ message: msg }] })), 500);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  const sayLog = path.join(work, "say.log");
  const sayBin = path.join(work, "say");
  fs.writeFileSync(sayBin, `#!/bin/sh\nif [ "$1" = "-v" ] && [ "$2" = "?" ]; then exit 0; fi\nprintf '%s %s\\n' "$(date +%s.%N | cut -c7-14)" "$*" >> "${sayLog}"\nsleep 0.3\n`, { mode: 0o755 });
  const queueFile = path.join(work, "whisper-queue.txt");
  fs.writeFileSync(queueFile, queue.join("\n") + "\n");
  const whisperBin = path.join(work, "whisper-cli");
  fs.writeFileSync(whisperBin, `#!/bin/sh\nq="${queueFile}"\nline=$(head -n1 "$q")\ntail -n +2 "$q" > "$q.tmp" && mv "$q.tmp" "$q"\nprintf '%s whisper -> %s\\n' "$(date +%s.%N | cut -c7-14)" "$line" >> "${sayLog}"\nprintf ' %s\\n' "$line"\n`, { mode: 0o755 });
  const model = path.join(work, "ggml-fake.bin");
  fs.writeFileSync(model, "fake");
  const wav = path.join(work, "mic.wav");
  fs.writeFileSync(wav, timeline(audio));

  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({ provider: "custom", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: "mock", allowedRoots: [allowed], projectsRoot: path.join(allowed, "Projects"), whisperBin: real ? process.env.WHISPER_BIN : whisperBin, whisperModel: real ? process.env.WHISPER_MODEL : model, sttEngine: "local", followUpSeconds: 8, ...settings }),
  );

  const app = spawn(
    "xvfb-run",
    ["-a", "node_modules/electron/dist/electron", ".", "--no-sandbox", `--user-data-dir=${userData}`, `--remote-debugging-port=${debugPort}`, "--e2e", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`, ...(settings.wakeWordEnabled ? [] : ["--show"])],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LAUNCHER_SAY: sayBin } },
  );
  app.stderr.on("data", (d) => {
    const s = String(d);
    if (!/dbus|gpu|GLib|libva|Fontconfig|ALSA|pulse/i.test(s)) process.stdout.write("[app!] " + s);
  });

  try {
    let target;
    for (let i = 0; i < 60 && !target; i++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((x) => x.type === "page");
      } catch {}
      if (!target) await sleep(500);
    }
    if (!target) throw new Error("fenêtre introuvable");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
      }
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result.result.value;
    };
    const shot = async (n) => fs.writeFileSync(path.join(outDir, `${n}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    const text = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.innerText).join('\\n')`);
    const waitFor = async (label, fn, ms = 30000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await fn()) return true;
        await sleep(250);
      }
      console.log("  (délai dépassé :", label + ")");
      return false;
    };
    const said = () => (fs.existsSync(sayLog) ? fs.readFileSync(sayLog, "utf8") : "");
    await sleep(1500);
    await run({ ev, text, waitFor, said, shot, check, sleep, queueFile });
  } finally {
    app.kill("SIGKILL");
    server.close();
    spawn("pkill", ["-f", `remote-debugging-port=${debugPort}`]);
  }
}

// 1. Conversation : demande orale -> confirmation orale « oui » -> réponse lue -> « merci, c'est tout ».
await scenario("conversation vocale avec confirmation orale", {
  port: 9344,
  settings: {},
  audio: [2, "lance une commande shell", 6, "oui", 7, "merci, c'est tout", 3],
  queue: ["lance une commande shell", "oui, vas-y", "merci c'est tout"],
  async run({ ev, text, waitFor, said, shot, check, queueFile }) {
    check("l'API vocale est exposée", await ev("typeof window.launcher.speak === 'function' && typeof window.launcher.parseVoice === 'function'"));
    const status = await ev("window.launcher.voiceStatus().then(s => s.local.ready)");
    check("Whisper local détecté (faux binaire + modèle)", status === true);
    await ev("document.getElementById('mic-btn').click()");
    check("le micro passe en écoute", await waitFor("écoute", () => ev("document.getElementById('mic-btn').dataset.voice === 'listening'"), 8000));
    await shot("voice-1-listening");
    check("la phrase dictée apparaît comme message", await waitFor("message", async () => (await text(".msg.user")).includes("lance une commande shell")));
    check("une confirmation est demandée", await waitFor("confirm", () => ev("Boolean(document.querySelector('.confirm'))")));
    await shot("voice-2-confirm");
    check("la question de confirmation est lue", await waitFor("say", async () => /autoriser/i.test(said()), 8000), said().split("\n")[0]);
    check("« oui » à l'oral autorise l'action", await waitFor("autorisé", async () => (await text(".confirm")).includes("Autorisé")));
    check("la réponse finale est affichée", await waitFor("réponse", async () => (await text(".msg.assistant")).includes("Terminé, la commande")));
    check("la réponse est lue à voix haute", await waitFor("say réponse", async () => said().includes("Terminé, la commande"), 8000));
    check("« merci, c'est tout » termine la conversation", await waitFor("fin", () => ev("document.getElementById('mic-btn').dataset.voice === ''"), 25000));
    check("« à bientôt » est dit", said().includes("bientôt"));
    check("toutes les phrases Whisper ont été consommées", fs.readFileSync(queueFile, "utf8").trim() === "");
    console.log("  journal say :\n   " + said().trim().split("\n").join("\n   "));
    await shot("voice-3-end");
  },
});

// 2. Mot d'activation : « hey cursor … » prononcé fenêtre cachée -> la fenêtre apparaît et la demande part.
await scenario("mot d'activation (écoute locale)", {
  port: 9345,
  settings: { wakeWordEnabled: true, wakePhrase: "hey cursor", sttEngine: "api" },
  audio: [2, "hey cursor, liste mes fichiers", 2],
  queue: ["Hey Cursor, liste mes fichiers."],
  async run({ ev, text, waitFor, said, shot, check }) {
    check("le micro est à l'écoute du mot d'activation", await waitFor("wake", () => ev("document.getElementById('mic-btn').dataset.voice === 'wake'"), 10000));
    check("la demande suivant le mot d'activation est envoyée (même avec moteur « api »)", await waitFor("message", async () => (await text(".msg.user")).includes("liste mes fichiers"), 25000));
    check("la réponse est lue", await waitFor("say", async () => said().includes("a.txt"), 15000));
    await shot("voice-4-wake");
  },
});

// 3. Optionnel : vrai whisper.cpp (WHISPER_BIN=… WHISPER_MODEL=… node scripts/e2e-voice.mjs).
if (process.env.WHISPER_BIN && process.env.WHISPER_MODEL) {
  await scenario("vrai Whisper local (espeak -> whisper.cpp)", {
    real: true,
    port: 9346,
    settings: {},
    audio: [2, "liste mes fichiers", 12],
    queue: [],
    async run({ ev, text, waitFor, said, check }) {
      await ev("document.getElementById('mic-btn').click()");
      check("une phrase est transcrite par le vrai Whisper (la précision dépend du modèle et de la voix espeak)", await waitFor("message", async () => /🎙 \S+/.test(await text(".msg.user")), 60000), (await text(".msg.user")).trim());
      check("la réponse est lue", await waitFor("say", async () => said().includes("a.txt"), 20000));
    },
  });
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
