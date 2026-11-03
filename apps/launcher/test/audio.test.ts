import { describe, expect, it } from "vitest";
import { Endpointer, SAMPLE_RATE, encodeWav, resampleLinear, rms } from "../src/renderer/audio";

const tone = (ms: number, amp = 0.2) => Float32Array.from({ length: (SAMPLE_RATE * ms) / 1000 }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE));
const hiss = (ms: number, amp = 0.002) => Float32Array.from({ length: (SAMPLE_RATE * ms) / 1000 }, (_, i) => amp * Math.sin(i * 12.9898));

/** Alimente l'endpointer par blocs de 4096 échantillons, comme le ferait Web Audio. */
function feed(ep: Endpointer, signal: Float32Array): void {
  for (let i = 0; i < signal.length; i += 4096) ep.push(signal.slice(i, i + 4096));
}
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe("audio", () => {
  it("mesure le niveau et rééchantillonne", () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(tone(100, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 2);
    const down = resampleLinear(new Float32Array(48000), 48000, 16000);
    expect(down.length).toBe(16000);
  });

  it("encode un WAV PCM 16 bits mono valide", () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5]), 16000);
    const view = new DataView(wav.buffer);
    const text = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(wav.length).toBe(44 + 8);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });
});

describe("détection de parole", () => {
  it("détecte une phrase entre deux silences, avec un peu de silence avant et après", () => {
    const ep = new Endpointer({ startTimeoutMs: 5000 });
    feed(ep, concat(hiss(800), tone(1200), hiss(1500)));
    expect(ep.status).toBe("done");
    const audio = ep.audio()!;
    const seconds = audio.length / SAMPLE_RATE;
    expect(seconds).toBeGreaterThan(1.2);
    expect(seconds).toBeLessThan(2.0);
    expect(rms(audio)).toBeGreaterThan(0.05);
  });

  it("abandonne si personne ne parle", () => {
    const ep = new Endpointer({ startTimeoutMs: 1500 });
    feed(ep, hiss(4000));
    expect(ep.status).toBe("timeout");
    expect(ep.audio()).toBeNull();
  });

  it("sans délai (mot d'activation) : attend indéfiniment", () => {
    const ep = new Endpointer({ startTimeoutMs: null });
    feed(ep, hiss(20_000));
    expect(ep.status).toBe("waiting");
    feed(ep, concat(tone(700), hiss(1500)));
    expect(ep.status).toBe("done");
  });

  it("ignore un claquement très bref", () => {
    const ep = new Endpointer({ startTimeoutMs: 6000 });
    feed(ep, concat(hiss(800), tone(100), hiss(2000)));
    expect(ep.status).not.toBe("done");
  });

  it("s'adapte à un bruit de fond élevé (seuils proportionnels)", () => {
    const ep = new Endpointer({ startTimeoutMs: 6000 });
    feed(ep, concat(hiss(800, 0.02), tone(1000, 0.3), hiss(1500, 0.02)));
    expect(ep.status).toBe("done");
    const quiet = new Endpointer({ startTimeoutMs: 3000 });
    feed(quiet, hiss(5000, 0.02));
    expect(quiet.status).toBe("timeout");
  });

  it("coupe une phrase trop longue et permet de terminer à la main", () => {
    const ep = new Endpointer({ startTimeoutMs: 5000, maxMs: 3000 });
    feed(ep, concat(hiss(600), tone(8000)));
    expect(ep.status).toBe("done");
    expect(ep.audio()!.length / SAMPLE_RATE).toBeLessThan(4);

    const manual = new Endpointer({ startTimeoutMs: 5000 });
    feed(manual, concat(hiss(600), tone(1000)));
    expect(manual.status).toBe("recording");
    expect(manual.finish()!.length / SAMPLE_RATE).toBeGreaterThan(0.9);
  });

  it("réutilise un bruit de fond déjà mesuré (pas de recalibrage)", () => {
    const first = new Endpointer({ startTimeoutMs: 5000 });
    feed(first, hiss(1000));
    const second = new Endpointer({ startTimeoutMs: 5000, noiseFloor: first.noiseFloor });
    expect(second.status).toBe("waiting");
    feed(second, concat(tone(500), hiss(1500)));
    expect(second.status).toBe("done");
  });
});
