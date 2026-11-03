import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultPiperBin, findPiperModel, isPythonBin, lengthScaleFor, parseWroteLine, piperCommand, piperText, resolveTts, voicesDir, type TtsSettings } from "../src/core/piper";
import { PiperTts } from "../src/main/piper";
import { createSpeaker } from "../src/main/speech";

const base: TtsSettings = { ttsEngine: "auto", piperBin: "", piperModel: "", ttsRate: 185 };

describe("choix du moteur de voix", () => {
  it("convertit le débit en durée des phonèmes", () => {
    expect(lengthScaleFor(185)).toBe(1);
    expect(lengthScaleFor(370)).toBe(0.6);
    expect(lengthScaleFor(100)).toBe(1.6);
    expect(lengthScaleFor(undefined)).toBe(1);
    expect(lengthScaleFor(Number.NaN)).toBe(1);
  });

  it("lance un interpréteur Python avec -m piper et un binaire piper directement", () => {
    expect(isPythonBin("/x/venv/bin/python3")).toBe(true);
    expect(isPythonBin("/opt/homebrew/bin/piper")).toBe(false);
    expect(piperCommand({ bin: "/x/python3", model: "/m.onnx" }, "/out", 1.2).args.slice(0, 2)).toEqual(["-m", "piper"]);
    const direct = piperCommand({ bin: "/x/piper", model: "/m.onnx" }, "/out", 1.2);
    expect(direct.args.slice(0, 2)).toEqual(["-m", "/m.onnx"]);
    expect(direct.args).toContain("--length-scale");
  });

  it("lit le chemin du WAV dans le journal de Piper et ignore le reste", () => {
    expect(parseWroteLine("INFO:__main__:Wrote /tmp/a b/123.wav")).toBe("/tmp/a b/123.wav");
    expect(parseWroteLine("INFO:__main__:Loading model")).toBeNull();
  });

  it("n'envoie à Piper que du texte prononçable, sur une seule ligne", () => {
    expect(piperText("Bonjour\n  tout   le monde")).toBe("Bonjour tout le monde");
    expect(piperText("… — ?")).toBe("");
  });

  it("préfère la voix siwis, puis une voix française, puis n'importe laquelle", () => {
    const list = (names: string[]) => () => names;
    expect(findPiperModel("/h", list(["en_US-amy-low.onnx", "fr_FR-tom-medium.onnx", "fr_FR-siwis-medium.onnx"]))).toBe(path.join(voicesDir("/h"), "fr_FR-siwis-medium.onnx"));
    expect(findPiperModel("/h", list(["en_US-amy-low.onnx", "fr_FR-tom-medium.onnx"]))).toBe(path.join(voicesDir("/h"), "fr_FR-tom-medium.onnx"));
    expect(findPiperModel("/h", list(["en_US-amy-low.onnx", "a.json"]))).toBe(path.join(voicesDir("/h"), "en_US-amy-low.onnx"));
    expect(findPiperModel("/h", list([]))).toBeNull();
  });

  it("utilise Piper quand il est installé et se replie sur say sinon", () => {
    const home = "/h";
    const model = path.join(voicesDir(home), "fr_FR-siwis-medium.onnx");
    const files = new Set([defaultPiperBin(home), model, `${model}.json`]);
    const exists = (p: string) => files.has(p);
    const ready = resolveTts({ ...base, piperModel: model }, home, exists);
    expect(ready.engine).toBe("piper");
    files.delete(`${model}.json`);
    const noJson = resolveTts({ ...base, piperModel: model }, home, exists);
    expect(noJson.engine).toBe("say");
    expect(noJson.detail).toMatch(/\.json manquant/);
    expect(resolveTts({ ...base, ttsEngine: "piper", piperModel: model }, home, exists).detail).toMatch(/Piper demandé mais indisponible/);
    expect(resolveTts({ ...base, ttsEngine: "say", piperModel: model }, home, () => true).engine).toBe("say");
    expect(resolveTts(base, "/vide", () => false)).toMatchObject({ engine: "say", piperReason: expect.stringContaining("npm run tts:install") });
  });
});

const dirs: string[] = [];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "piper-"));
  dirs.push(dir);
  const log = path.join(dir, "log.txt");
  const piper = path.join(dir, "piper");
  fs.writeFileSync(
    piper,
    `#!${process.execPath}
const fs = require("fs"), path = require("path");
const a = process.argv;
const dir = a[a.indexOf("-d") + 1];
fs.appendFileSync(${JSON.stringify(log)}, "ARGS " + a.slice(2).join(" ") + "\\n");
let n = 0;
require("readline").createInterface({ input: process.stdin }).on("line", (l) => {
  if (l === "CRASH") process.exit(2);
  const f = path.join(dir, ++n + ".wav");
  fs.writeFileSync(f, l);
  process.stderr.write("INFO:__main__:Wrote " + f + "\\n");
});
`,
    { mode: 0o755 },
  );
  const play = path.join(dir, "play");
  fs.writeFileSync(play, `#!/bin/sh\necho "PLAY $(cat "$1")" >> ${JSON.stringify(log)}\n`, { mode: 0o755 });
  const say = path.join(dir, "say");
  fs.writeFileSync(say, `#!/bin/sh\nfor last; do :; done\necho "SAY $last" >> ${JSON.stringify(log)}\n`, { mode: 0o755 });
  const model = path.join(dir, "voix.onnx");
  fs.writeFileSync(model, "x");
  fs.writeFileSync(`${model}.json`, "{}");
  process.env.LAUNCHER_PLAY = play;
  process.env.LAUNCHER_SAY = say;
  const settings: TtsSettings = { ttsEngine: "piper", piperBin: piper, piperModel: model, ttsRate: 185 };
  const tts = new PiperTts(() => settings, dir);
  return { dir, log, tts, settings, lines: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []) };
}

afterEach(() => {
  delete process.env.LAUNCHER_PLAY;
  delete process.env.LAUNCHER_SAY;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("voix Piper (processus externe)", () => {
  it("dit les phrases dans l'ordre avec un seul processus Piper et nettoie les fichiers", async () => {
    const t = setup();
    const speaker = createSpeaker(t.tts.start);
    await speaker.speak("Bonjour Riana. Comment vas-tu ? Très bien.", { rate: 185 });
    t.tts.dispose();
    const lines = t.lines();
    expect(lines.filter((l) => l.startsWith("ARGS"))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("PLAY"))).toEqual(["PLAY Bonjour Riana.", "PLAY Comment vas-tu ?", "PLAY Très bien."]);
    expect(lines.some((l) => l.startsWith("SAY"))).toBe(false);
  });

  it("ne passe jamais le texte par un shell", async () => {
    const t = setup();
    const speaker = createSpeaker(t.tts.start);
    await speaker.speak("Salut $(rm -rf /) `x`.");
    t.tts.dispose();
    expect(t.lines()).toContain("PLAY Salut $(rm -rf /) `x`.");
  });

  it("applique le débit demandé aux phonèmes", async () => {
    const t = setup();
    t.settings.ttsRate = 370;
    await createSpeaker(t.tts.start).speak("Vite.");
    t.tts.dispose();
    expect(t.lines()[0]).toMatch(/--length-scale 0\.6/);
  });

  it("se replie sur say si Piper plante, sans perdre la phrase, puis reste sur say", async () => {
    const t = setup();
    const speaker = createSpeaker(t.tts.start);
    await speaker.speak("CRASH");
    await speaker.speak("Encore une phrase.");
    t.tts.dispose();
    const lines = t.lines();
    expect(lines.filter((l) => l.startsWith("SAY"))).toEqual(["SAY CRASH", "SAY Encore une phrase."]);
    expect((await t.tts.status()).detail).toMatch(/Piper a échoué/);
  });

  it("réessaie Piper quand les réglages changent après un échec", async () => {
    const t = setup();
    const speaker = createSpeaker(t.tts.start);
    await speaker.speak("CRASH");
    t.settings.ttsRate = 200;
    await speaker.speak("Ça remarche.");
    t.tts.dispose();
    expect(t.lines()).toContain("PLAY Ça remarche.");
  });

  it("utilise say quand aucune voix Piper n'est installée", async () => {
    const t = setup();
    t.settings.piperModel = path.join(t.dir, "absente.onnx");
    await createSpeaker(t.tts.start).speak("Bonjour.");
    t.tts.dispose();
    expect(t.lines()).toEqual(["SAY Bonjour."]);
    expect((await t.tts.status()).engine).toBe("say");
  });

  it("s'interrompt à la demande, même pendant la lecture", async () => {
    const t = setup();
    fs.writeFileSync(process.env.LAUNCHER_PLAY!, `#!/bin/sh\necho "PLAY $(cat "$1")" >> ${JSON.stringify(t.log)}\nsleep 5\n`, { mode: 0o755 });
    const speaker = createSpeaker(t.tts.start);
    const p = speaker.speak("Une. Deux. Trois.");
    await new Promise((r) => setTimeout(r, 700));
    const t0 = Date.now();
    speaker.stop();
    await p;
    t.tts.dispose();
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(t.lines().filter((l) => l.startsWith("PLAY"))).toEqual(["PLAY Une."]);
  });

  it("ne synthétise rien pour une phrase sans mot", async () => {
    const t = setup();
    await createSpeaker(t.tts.start).speak("Oui. … Non.");
    t.tts.dispose();
    expect(t.lines().filter((l) => l.startsWith("PLAY"))).toEqual(["PLAY Oui.", "PLAY Non."]);
  });
});

const realHome = process.env.PIPER_TEST_HOME;
describe.skipIf(!realHome || !fs.existsSync(path.join(realHome ?? "", ".cursor-launcher", "piper")))("vrai Piper (PIPER_TEST_HOME)", () => {
  it("synthétise une phrase française avec la voix installée", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "piper-real-"));
    dirs.push(dir);
    const log = path.join(dir, "log.txt");
    const play = path.join(dir, "play");
    fs.writeFileSync(play, `#!/bin/sh\nstat -c %s "$1" >> ${JSON.stringify(log)}\n`, { mode: 0o755 });
    process.env.LAUNCHER_PLAY = play;
    const tts = new PiperTts(() => ({ ...base }), realHome);
    expect((await tts.status()).engine).toBe("piper");
    await createSpeaker(tts.start).speak("Bonjour Riana. Tout est prêt.");
    tts.dispose();
    const sizes = fs.readFileSync(log, "utf8").trim().split("\n").map(Number);
    expect(sizes).toHaveLength(2);
    expect(sizes.every((n) => n > 20_000)).toBe(true);
  });
});
