/** Traitement audio pur (sans DOM) : mesure de niveau, détection début/fin de parole, encodage WAV. */

export const SAMPLE_RATE = 16000;

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Rééchantillonnage linéaire (repli quand le navigateur ne fournit pas du 16 kHz). */
export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const length = Math.max(1, Math.round((input.length * to) / from));
  const out = new Float32Array(length);
  const ratio = from / to;
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** WAV PCM 16 bits mono : le format attendu par whisper.cpp et par l'API Whisper. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export interface EndpointerOptions {
  sampleRate?: number;
  /** Abandon si personne ne parle dans ce délai ; `null` = attendre indéfiniment (mot d'activation). */
  startTimeoutMs: number | null;
  /** Durée maximale d'un enregistrement. */
  maxMs?: number;
  /** Silence qui marque la fin d'une phrase. */
  silenceMs?: number;
  /** Parole plus courte que ça = bruit (claquement…), ignorée. */
  minSpeechMs?: number;
  /** Bruit ambiant déjà mesuré (évite de recalibrer à chaque écoute). */
  noiseFloor?: number;
}

export type EndpointStatus = "calibrating" | "waiting" | "recording" | "done" | "timeout";

const FRAME = 320; // 20 ms à 16 kHz
const SPEECH_FRAMES = 3;
const PRE_ROLL_FRAMES = 15;

/**
 * Détecte le début et la fin d'une phrase à partir du niveau sonore, avec des seuils calés sur le bruit
 * ambiant (même idée que l'auto-calibration de Jarvis : on mesure la pièce, on ne devine pas le micro).
 */
export class Endpointer {
  private readonly opts: Required<Omit<EndpointerOptions, "startTimeoutMs" | "noiseFloor">> & { startTimeoutMs: number | null };
  private pending = new Float32Array(0);
  private frames: Float32Array[] = [];
  private levels: number[] = [];
  private calibration: number[] = [];
  private frameCount = 0;
  private startFrame = -1;
  private speechFrame = -1;
  private lastLoudFrame = -1;
  private loudRun = 0;
  private sinceReady = 0;
  private speechThreshold = 0.015;
  private silenceThreshold = 0.008;
  private calibrated = false;
  private _floor = 0;
  private _status: EndpointStatus = "calibrating";
  private _level = 0;

  constructor(options: EndpointerOptions) {
    this.opts = {
      sampleRate: options.sampleRate ?? SAMPLE_RATE,
      startTimeoutMs: options.startTimeoutMs,
      maxMs: options.maxMs ?? 30_000,
      silenceMs: options.silenceMs ?? 1100,
      minSpeechMs: options.minSpeechMs ?? 180,
    };
    if (options.noiseFloor !== undefined) this.applyFloor(options.noiseFloor);
  }

  get status(): EndpointStatus {
    return this._status;
  }
  get level(): number {
    return this._level;
  }
  get noiseFloor(): number {
    return this._floor;
  }

  private applyFloor(floor: number): void {
    this._floor = Math.min(floor, 0.03);
    this.speechThreshold = Math.min(0.12, Math.max(0.012, this._floor * 4.5));
    this.silenceThreshold = Math.min(0.05, Math.max(0.006, this._floor * 2.2));
    this.calibrated = true;
    this._status = "waiting";
  }

  private get over(): boolean {
    return this._status === "done" || this._status === "timeout";
  }

  private ms(frames: number): number {
    return (frames * FRAME * 1000) / this.opts.sampleRate;
  }

  push(chunk: Float32Array): EndpointStatus {
    if (this._status === "done" || this._status === "timeout") return this._status;
    const joined = new Float32Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    let offset = 0;
    while (joined.length - offset >= FRAME && !this.over) {
      this.frame(joined.slice(offset, offset + FRAME));
      offset += FRAME;
    }
    this.pending = joined.slice(offset);
    return this._status;
  }

  private frame(samples: Float32Array): void {
    const level = rms(samples);
    this._level = level;
    const index = this.frameCount++;
    this.frames.push(samples);
    this.levels.push(level);

    if (!this.calibrated) {
      this.calibration.push(level);
      if (this.calibration.length >= 25) {
        const sorted = [...this.calibration].sort((a, b) => a - b);
        this.applyFloor(sorted[Math.floor(sorted.length * 0.3)]);
      }
      return;
    }

    this.sinceReady++;
    const recording = this.startFrame >= 0;
    if (!recording) {
      this.loudRun = level > this.speechThreshold ? this.loudRun + 1 : 0;
      if (this.loudRun >= SPEECH_FRAMES) {
        this.speechFrame = index - this.loudRun + 1;
        this.startFrame = Math.max(0, this.speechFrame - PRE_ROLL_FRAMES);
        this.lastLoudFrame = index;
        this._status = "recording";
      } else {
        const keep = PRE_ROLL_FRAMES + SPEECH_FRAMES;
        if (this.frames.length > keep + 50) {
          const drop = this.frames.length - keep;
          this.frames.splice(0, drop);
          this.levels.splice(0, drop);
          this.frameCount -= drop;
        }
      }
      if (this.opts.startTimeoutMs !== null && this.ms(this.sinceReady) >= this.opts.startTimeoutMs && this.startFrame < 0) this._status = "timeout";
      return;
    }

    if (level > this.silenceThreshold) this.lastLoudFrame = index;
    const silentFor = this.ms(index - this.lastLoudFrame);
    const total = this.ms(index - this.startFrame);
    if (silentFor >= this.opts.silenceMs) {
      const spoken = this.ms(this.lastLoudFrame - this.speechFrame + 1);
      if (spoken >= this.opts.minSpeechMs) {
        this._status = "done";
      } else {
        this.startFrame = -1;
        this.speechFrame = -1;
        this.loudRun = 0;
        this._status = "waiting";
      }
    } else if (total >= this.opts.maxMs) {
      this._status = "done";
    }
  }

  /** Audio de la phrase (avec un peu de silence avant) ; `null` tant que rien n'est terminé. */
  audio(): Float32Array | null {
    if (this._status !== "done" || this.startFrame < 0) return null;
    const first = Math.max(0, this.startFrame);
    const end = Math.min(this.frames.length, this.lastLoudFrame + 1 + 10);
    const parts = this.frames.slice(first, end);
    const out = new Float32Array(parts.length * FRAME);
    parts.forEach((p, i) => out.set(p, i * FRAME));
    return out;
  }

  /** Termine immédiatement (clic sur le micro) : renvoie ce qui a été dit jusque-là. */
  finish(): Float32Array | null {
    if (this.startFrame < 0) return null;
    this.lastLoudFrame = this.frames.length - 1;
    this._status = "done";
    return this.audio();
  }
}
