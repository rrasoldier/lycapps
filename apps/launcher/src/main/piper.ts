import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { lengthScaleFor, parseWroteLine, piperCommand, piperModuleStatus, piperText, resolveTts, type PiperConfig, type TtsSettings } from "../core/piper";
import { makeRunner } from "../core/updater";
import type { SpeechHandle } from "../core/voice";
import { startSay } from "./speech";

const FIRST_TIMEOUT_MS = 60_000;
const NEXT_TIMEOUT_MS = 20_000;
const IDLE_MS = 5 * 60_000;

/** Lecteur de fichiers WAV : `afplay` sur macOS ; `LAUNCHER_PLAY` permet de le remplacer (tests, autre plateforme). */
function playerCommand(wav: string): { cmd: string; args: string[] } {
  const custom = process.env.LAUNCHER_PLAY;
  if (custom) return { cmd: custom, args: [wav] };
  if (process.platform === "darwin") return { cmd: "afplay", args: [wav] };
  return { cmd: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "quiet", wav] };
}

function playWav(wav: string): SpeechHandle {
  const { cmd, args } = playerCommand(wav);
  const child = spawn(cmd, args, { stdio: "ignore" });
  let killed = false;
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (killed || code === 0 ? resolve() : reject(new Error(`lecture audio échouée (code ${code})`))));
  }).finally(() => fs.rm(wav, { force: true }, () => undefined));
  return {
    done,
    kill() {
      killed = true;
      child.kill("SIGTERM");
    },
  };
}

interface Pending {
  resolve: (wav: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Processus Piper gardé en vie : le modèle n'est chargé qu'une fois, chaque phrase envoyée sur stdin produit
 * un WAV dont le chemin est annoncé dans le journal (stderr). Les réponses arrivent dans l'ordre des envois.
 */
export class PiperWorker {
  private child: ChildProcess | null = null;
  private dir = "";
  private pending: Pending[] = [];
  private buffer = "";
  private served = 0;
  private idle: NodeJS.Timeout | null = null;

  constructor(
    readonly cfg: PiperConfig,
    readonly lengthScale: number,
  ) {}

  private start(): ChildProcess {
    if (this.child) return this.child;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "alphacris-tts-"));
    const { cmd, args } = piperCommand(this.cfg, this.dir, this.lengthScale);
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    this.child = child;
    this.buffer = "";
    this.served = 0;
    let errTail = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      errTail = (errTail + chunk).slice(-400);
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        const wav = parseWroteLine(line);
        if (wav) this.deliver(path.resolve(this.dir, wav));
      }
    });
    const fail = (err: Error) => {
      if (this.child !== child) return;
      this.child = null;
      const rejected = this.pending.splice(0);
      for (const p of rejected) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.cleanDir();
    };
    child.on("error", (e) => fail(new Error(`Piper n'a pas pu démarrer : ${e.message}`)));
    child.on("close", (code) => fail(new Error(`Piper s'est arrêté (code ${code}). ${errTail.trim().split("\n").pop() ?? ""}`.trim())));
    child.stdin?.on("error", () => undefined);
    return child;
  }

  private deliver(wav: string): void {
    const next = this.pending.shift();
    if (!next) return fs.rm(wav, { force: true }, () => undefined);
    clearTimeout(next.timer);
    this.served++;
    next.resolve(wav);
  }

  private cleanDir(): void {
    if (this.dir) fs.rm(this.dir, { recursive: true, force: true }, () => undefined);
    this.dir = "";
  }

  /** Synthétise une phrase ; renvoie le chemin d'un WAV (à supprimer par l'appelant) ou null s'il n'y a rien à dire. */
  synthesize(sentence: string): Promise<string | null> {
    const text = piperText(sentence);
    if (!text) return Promise.resolve(null);
    const child = this.start();
    this.touch();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          reject(new Error("Piper ne répond pas."));
          this.stop();
        },
        this.served === 0 ? FIRST_TIMEOUT_MS : NEXT_TIMEOUT_MS,
      );
      this.pending.push({ resolve, reject, timer });
      child.stdin?.write(`${text}\n`, (err) => {
        if (err) reject(err);
      });
    });
  }

  /** Charge le modèle en avance (la première phrase est alors rapide). */
  warmUp(): void {
    try {
      this.start();
      this.touch();
    } catch {
      /* l'erreur sera remontée à la première synthèse */
    }
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    this.idle.unref();
  }

  stop(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const child = this.child;
    this.child = null;
    for (const p of this.pending.splice(0)) {
      clearTimeout(p.timer);
      p.reject(new Error("Piper arrêté."));
    }
    if (child) {
      child.stdin?.end();
      child.kill("SIGTERM");
    }
    this.cleanDir();
  }
}

export interface TtsStatus {
  engine: "piper" | "say";
  detail: string;
}

/**
 * Synthèse vocale de l'application : Piper (voix neuronale locale) quand il est installé, sinon `say`.
 * Si Piper échoue en cours de route, la phrase est dite avec `say` et Piper est écarté jusqu'au changement de réglages.
 */
export class PiperTts {
  private worker: PiperWorker | null = null;
  private failure: { key: string; message: string } | null = null;

  constructor(
    private readonly getSettings: () => TtsSettings,
    private readonly home: string = os.homedir(),
  ) {}

  private current(): { worker: PiperWorker; key: string } | null {
    const s = this.getSettings();
    const res = resolveTts(s, this.home);
    if (res.engine !== "piper") {
      this.dropWorker();
      return null;
    }
    const scale = lengthScaleFor(s.ttsRate);
    const key = JSON.stringify([res.cfg, scale]);
    if (this.failure?.key === key) return null;
    if (!this.worker || this.worker.cfg.bin !== res.cfg.bin || this.worker.cfg.model !== res.cfg.model || this.worker.lengthScale !== scale) {
      this.dropWorker();
      this.worker = new PiperWorker(res.cfg, scale);
    }
    return { worker: this.worker, key };
  }

  private dropWorker(): void {
    this.worker?.stop();
    this.worker = null;
  }

  /** Démarreur compatible avec `Speaker` : une phrase, un handle interruptible. */
  start = (sentence: string, voice: string | undefined, rate: number | undefined): SpeechHandle => {
    const cur = this.current();
    if (!cur) return startSay(sentence, voice, rate);
    let killed = false;
    let inner: SpeechHandle | null = null;
    const done = (async () => {
      try {
        const wav = await cur.worker.synthesize(sentence);
        if (!wav) return;
        if (killed) return void fs.rm(wav, { force: true }, () => undefined);
        inner = playWav(wav);
        await inner.done;
      } catch (err) {
        if (killed) return;
        this.failure = { key: cur.key, message: err instanceof Error ? err.message : String(err) };
        this.dropWorker();
        inner = startSay(sentence, voice, rate);
        await inner.done;
      }
    })();
    return {
      done,
      kill() {
        killed = true;
        inner?.kill();
      },
    };
  };

  async status(): Promise<TtsStatus> {
    const s = this.getSettings();
    const res = resolveTts(s, this.home);
    if (res.engine !== "piper") return { engine: "say", detail: res.detail };
    const mod = await piperModuleStatus(res.cfg, makeRunner());
    if (!mod.ok) return { engine: "say", detail: s.ttsEngine === "piper" ? `Piper demandé mais indisponible : ${mod.detail} Repli sur la voix du Mac.` : `Voix du Mac (say). ${mod.detail}` };
    const key = JSON.stringify([res.cfg, lengthScaleFor(s.ttsRate)]);
    if (this.failure?.key === key) return { engine: "say", detail: `Piper a échoué (${this.failure.message}) : repli sur la voix du Mac jusqu'au prochain changement de réglages.` };
    return { engine: "piper", detail: res.detail };
  }

  /** À appeler quand une conversation vocale démarre : charge le modèle pendant que l'utilisatrice parle. */
  warmUp(): void {
    this.current()?.worker.warmUp();
  }

  dispose(): void {
    this.dropWorker();
  }
}
