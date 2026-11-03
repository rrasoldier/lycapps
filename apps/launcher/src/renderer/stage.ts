/**
 * Scène vocale : un orbe et des ondes qui réagissent au niveau du micro (quand l'utilisatrice parle) et à une
 * enveloppe de parole simulée (quand l'assistant répond : la lecture audio se fait hors du processus de l'interface,
 * son niveau réel n'est donc pas disponible).
 */

export type StageMode = "idle" | "listening" | "thinking" | "speaking" | "wake";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Enveloppe d'une voix qui parle (0 à 1) : syllabes à ~4 Hz, groupes de mots, courtes pauses entre les phrases. */
export function speechEnvelope(t: number): number {
  const syllable = Math.abs(Math.sin(Math.PI * 4.2 * t)) ** 0.8;
  const accent = 0.65 + 0.35 * Math.sin(2 * Math.PI * 1.3 * t + 1.2);
  const phrase = clamp01((Math.sin(2 * Math.PI * 0.32 * t) + 0.55) * 2.2);
  const jitter = 0.12 * Math.sin(2 * Math.PI * 9.1 * t + 0.4);
  return clamp01((syllable * accent + jitter) * (0.25 + 0.75 * phrase));
}

/** Lissage d'un niveau : montée rapide, retombée plus lente (comme un vumètre). */
export function followLevel(current: number, target: number, dt: number): number {
  const rate = target > current ? 18 : 5;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Niveau visé par mode, avant lissage. `mic` vient du micro, `t` est le temps en secondes. */
export function targetLevel(mode: StageMode, mic: number, t: number): number {
  switch (mode) {
    case "listening":
      return clamp01(0.1 + mic * 0.95);
    case "speaking":
      return 0.12 + 0.8 * speechEnvelope(t);
    case "thinking":
      return 0.22 + 0.06 * Math.sin(t * 3);
    case "wake":
      return 0.05 + 0.02 * Math.sin(t * 1.1);
    default:
      return 0.09 + 0.05 * Math.sin(t * 1.25);
  }
}

interface Palette {
  a: number;
  b: number;
}

const PALETTES: Record<StageMode, Palette> = {
  idle: { a: 255, b: 195 },
  listening: { a: 262, b: 190 },
  thinking: { a: 285, b: 38 },
  speaking: { a: 190, b: 150 },
  wake: { a: 235, b: 205 },
};

const BARS = 112;
const PARTICLES = 46;

export class Stage {
  private ctx: CanvasRenderingContext2D;
  private mode: StageMode = "idle";
  private mic = 0;
  private level = 0.08;
  private hue = { ...PALETTES.idle };
  private raf = 0;
  private last = 0;
  private width = 0;
  private height = 0;
  private readonly started = performance.now();
  private readonly reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  private readonly seeds = Array.from({ length: PARTICLES }, (_, i) => ({ a: ((i * 137.5) % 360) * (Math.PI / 180), r: 1.5 + ((i * 53) % 100) / 38, s: 0.05 + ((i * 29) % 10) / 90, z: 0.4 + ((i * 17) % 10) / 14 }));

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D indisponible");
    this.ctx = ctx;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setMode(mode: StageMode): void {
    this.mode = mode;
  }

  /** Niveau du micro, de 0 à 1. */
  setLevel(level: number): void {
    this.mic = clamp01(level);
  }

  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.08, Math.max(0.001, (now - this.last) / 1000));
      this.last = now;
      this.draw((now - this.started) / 1000, dt);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private color(h: number, s: number, l: number, a: number): string {
    return `hsla(${h.toFixed(0)}, ${s}%, ${l}%, ${a.toFixed(3)})`;
  }

  private draw(t: number, dt: number): void {
    const { ctx, width: w, height: h } = this;
    const pal = PALETTES[this.mode];
    this.hue.a += (pal.a - this.hue.a) * (1 - Math.exp(-3 * dt));
    this.hue.b += (pal.b - this.hue.b) * (1 - Math.exp(-3 * dt));
    this.level = followLevel(this.level, targetLevel(this.mode, this.mic, t), dt);
    const lv = this.level;
    const ha = this.hue.a;
    const hb = this.hue.b;

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.4;
    const R = Math.max(40, Math.min(w, h * 1.05) * 0.15);
    const breath = 1 + 0.035 * Math.sin(t * 1.4);
    const body = R * breath * (1 + 0.16 * lv);

    ctx.globalCompositeOperation = "lighter";

    const glow = ctx.createRadialGradient(cx, cy, body * 0.4, cx, cy, body * (2.7 + lv * 1.3));
    glow.addColorStop(0, this.color(ha, 95, 62, 0.34 + lv * 0.25));
    glow.addColorStop(0.5, this.color(hb, 90, 55, 0.1 + lv * 0.08));
    glow.addColorStop(1, this.color(hb, 90, 55, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.lineCap = "round";
    for (let k = 0; k < 3; k++) {
      const amp = R * (0.12 + 0.62 * lv) * (1 - k * 0.28);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const nx = (x - cx) / (w / 2);
        const fade = Math.max(0, 1 - nx * nx);
        const y = cy + Math.sin(nx * (6 + k * 2.3) + t * (1.4 + k * 0.7) + k) * amp * fade + Math.sin(nx * 13 - t * 2.2 + k * 2) * amp * 0.25 * fade;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this.color(k === 1 ? hb : ha, 90, 65, 0.22 - k * 0.05);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    if (!this.reduced) {
      const speed = 0.16 + lv * 0.5;
      for (let k = 0; k < 3; k++) {
        const phase = (t * speed + k / 3) % 1;
        ctx.beginPath();
        ctx.arc(cx, cy, body * (1.1 + phase * 2.1), 0, Math.PI * 2);
        ctx.strokeStyle = this.color(k % 2 ? hb : ha, 90, 66, (1 - phase) ** 1.6 * (0.1 + lv * 0.42));
        ctx.lineWidth = 1.5 + (1 - phase) * 2;
        ctx.stroke();
      }
    }

    if (this.mode === "thinking") {
      for (let k = 0; k < 3; k++) {
        const start = t * (1.6 + k * 0.5) * (k % 2 ? -1 : 1) + k * 2.1;
        ctx.beginPath();
        ctx.arc(cx, cy, body * (1.2 + k * 0.17), start, start + 1.5 + 0.4 * Math.sin(t * 2 + k));
        ctx.strokeStyle = this.color(k % 2 ? hb : ha, 95, 68, 0.75 - k * 0.15);
        ctx.lineWidth = 3.2 - k * 0.6;
        ctx.stroke();
      }
    } else {
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const wobble = 0.5 + 0.5 * Math.sin(i * 0.9 + t * 3.1 + Math.sin(i * 0.31 + t * 1.3) * 2.4);
        const wobble2 = 0.5 + 0.5 * Math.sin(i * 2.3 - t * 4.7);
        const len = R * (0.05 + 0.82 * lv * (0.25 + 0.75 * wobble * (0.6 + 0.4 * wobble2)));
        const r0 = body * 1.1;
        const mix = 0.5 + 0.5 * Math.sin(a * 2 + t * 0.4);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        ctx.strokeStyle = this.color(ha + (hb - ha) * mix, 92, 66, 0.55 + 0.4 * lv);
        ctx.lineWidth = Math.max(1.5, (2 * Math.PI * r0) / BARS * 0.45);
        ctx.stroke();
      }
    }

    if (!this.reduced) {
      for (const p of this.seeds) {
        const a = p.a + t * p.s * (p.r % 2 > 1 ? 1 : -1);
        const r = body * (1.5 + p.r * 0.5 + lv * 0.4 * Math.sin(t * 2 + p.a));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.82, p.z * (1 + lv), 0, Math.PI * 2);
        ctx.fillStyle = this.color(p.z > 0.8 ? hb : ha, 90, 72, 0.2 + 0.35 * p.z * (0.4 + lv));
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = "source-over";
    const orb = ctx.createRadialGradient(cx - body * 0.32, cy - body * 0.38, body * 0.08, cx, cy, body);
    orb.addColorStop(0, this.color(hb, 100, 88, 0.98));
    orb.addColorStop(0.38, this.color(hb, 95, 62, 0.95));
    orb.addColorStop(0.78, this.color(ha, 90, 48, 0.96));
    orb.addColorStop(1, this.color(ha, 85, 30, 0.98));
    ctx.beginPath();
    ctx.arc(cx, cy, body, 0, Math.PI * 2);
    ctx.fillStyle = orb;
    ctx.shadowColor = this.color(ha, 95, 62, 0.8);
    ctx.shadowBlur = 30 + lv * 40;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, cy, body, 0, Math.PI * 2);
    ctx.strokeStyle = this.color(hb, 100, 85, 0.45 + lv * 0.3);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
