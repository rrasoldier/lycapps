import { describe, expect, it } from "vitest";
import { followLevel, speechEnvelope, targetLevel } from "../src/renderer/stage";
import { GREETING_TEXT, pronounceForSpeech } from "../src/core/greeting";

describe("scène vocale", () => {
  it("l'enveloppe de parole reste entre 0 et 1, varie, et marque des pauses", () => {
    const values = Array.from({ length: 800 }, (_, i) => speechEnvelope(i / 100));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    expect(Math.max(...values)).toBeGreaterThan(0.6);
    expect(values.filter((v) => v < 0.05).length).toBeGreaterThan(20);
  });

  it("le niveau monte vite et retombe lentement", () => {
    const up = followLevel(0, 1, 0.05);
    const down = 1 - followLevel(1, 0, 0.05);
    expect(up).toBeGreaterThan(down * 2);
    expect(followLevel(0.4, 0.4, 0.05)).toBeCloseTo(0.4);
  });

  it("suit le micro à l'écoute, la parole simulée quand l'assistant répond, et respire au repos", () => {
    expect(targetLevel("listening", 1, 0)).toBeGreaterThan(targetLevel("listening", 0, 0) + 0.5);
    expect(targetLevel("listening", 5, 0)).toBeLessThanOrEqual(1);
    const speaking = Array.from({ length: 200 }, (_, i) => targetLevel("speaking", 0, i / 20));
    expect(Math.max(...speaking) - Math.min(...speaking)).toBeGreaterThan(0.4);
    expect(targetLevel("idle", 1, 1)).toBeLessThan(0.2);
    expect(targetLevel("wake", 1, 1)).toBeLessThan(0.1);
  });
});

describe("prononciation du nom", () => {
  it("écrit « Cris » pour que la voix dise « criss »", () => {
    expect(pronounceForSpeech(GREETING_TEXT)).toBe("Bonjour, c'est Criss, à ton service.");
    expect(pronounceForSpeech("Cris")).toBe("Criss");
    expect(pronounceForSpeech("Je suis AlphaCris.")).toBe("Je suis Alpha Criss.");
    expect(pronounceForSpeech("Salut Cris !")).toBe("Salut Criss !");
  });

  it("ne touche ni aux cris ni aux autres mots", () => {
    expect(pronounceForSpeech("J'entends des cris. Crise de nerfs, Crisco, scris.")).toBe("J'entends des cris. Crise de nerfs, Crisco, scris.");
  });

  it("l'affichage garde « Cris »", () => {
    expect(GREETING_TEXT).toContain("c'est Cris,");
  });
});
