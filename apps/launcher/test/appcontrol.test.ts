import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgent, systemPrompt } from "../src/core/agent";
import type { AppControl } from "../src/core/appcontrol";
import { defaultSettings, type Settings } from "../src/core/settings";
import { checkTheme, DEFAULT_THEME, luminance, normalizeHex } from "../src/core/theme";
import { runTool, touchesProtected, type ToolContext } from "../src/core/tools";
import type { ChatMessage, LlmClient } from "../src/core/types";
import { hexToHsl, orbColors, themeVars } from "../src/renderer/theme";
import { palettesFor } from "../src/renderer/stage";
import { makeSandbox } from "./helpers";

let sb: ReturnType<typeof makeSandbox>;
afterEach(() => sb?.cleanup());

function fakeApp(over: Partial<AppControl> = {}) {
  let settings: Settings = defaultSettings("/home/x");
  const applied: Array<Partial<Settings>> = [];
  const app: AppControl = {
    settings: () => ({ ...settings }),
    apply(patch) {
      applied.push(patch);
      settings = { ...settings, ...patch };
      return { ...settings };
    },
    sayVoices: async () => ["Thomas", "Amélie", "Audrey"],
    piperVoices: () => ["fr_FR-siwis-medium", "fr_FR-upmc-medium"],
    piperModelPath: (n) => `/voices/${n}.onnx`,
    voiceStatus: async () => "Piper local prêt.",
    wakeProblem: async () => null,
    ...over,
  };
  return { app, applied, get: () => settings };
}

function ctxWith(app: AppControl, extra: Partial<ToolContext> = {}): ToolContext {
  sb = makeSandbox();
  return { ...sb.ctx, app, ...extra };
}

describe("thème : validation", () => {
  it("normalise les couleurs hexadécimales", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("  #7C5CFF ")).toBe("#7c5cff");
    expect(normalizeHex("rouge")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex(42)).toBeNull();
  });

  it("refuse un fond clair ou un accent invisible, accepte le thème d'origine", () => {
    expect(checkTheme(DEFAULT_THEME)).toBeNull();
    expect(checkTheme({ ...DEFAULT_THEME, themeBackground: "#ffffff" })).toMatch(/sombre/);
    expect(checkTheme({ ...DEFAULT_THEME, themeAccent: "#000000" })).toMatch(/visible|sombre/);
    expect(luminance("#ffffff")).toBeCloseTo(1, 2);
    expect(luminance("#000000")).toBe(0);
  });
});

describe("set_theme", () => {
  it("applique tout de suite un préréglage et confirme", async () => {
    const f = fakeApp();
    const r = await runTool("set_theme", { preset: "ocean" }, ctxWith(f.app));
    expect(r.ok).toBe(true);
    expect(f.get().themeAccent).toBe("#2f80ff");
    expect(f.applied).toHaveLength(1);
    expect(r.output).toContain("préréglage ocean");
  });

  it("accepte des couleurs et une opacité en pourcentage ou en ratio", async () => {
    const f = fakeApp();
    const r = await runTool("set_theme", { accent: "#FF00AA", glass: "60 %", border: 0.05 }, ctxWith(f.app));
    expect(r.ok).toBe(true);
    expect(f.get()).toMatchObject({ themeAccent: "#ff00aa", themeGlass: 0.6, themeBorder: 0.05 });
  });

  it("refuse les valeurs invalides sans rien enregistrer", async () => {
    const f = fakeApp();
    const ctx = ctxWith(f.app);
    for (const args of [{ accent: "bleu" }, { glass: 0.05 }, { glass: 5000 }, { border: 0.9 }, { preset: "inconnu" }, { background: "#f0f0f0" }, {}]) {
      const r = await runTool("set_theme", args, ctx);
      expect(r.ok, JSON.stringify(args)).toBe(false);
    }
    expect(f.applied).toHaveLength(0);
  });

  it("reset rétablit le thème d'origine", async () => {
    const f = fakeApp();
    const ctx = ctxWith(f.app);
    await runTool("set_theme", { preset: "rose", glass: 0.4 }, ctx);
    const r = await runTool("set_theme", { reset: true }, ctx);
    expect(r.ok).toBe(true);
    expect(f.get()).toMatchObject(DEFAULT_THEME);
  });
});

describe("set_voice", () => {
  it("change le moteur, la voix du Mac et le débit", async () => {
    const f = fakeApp();
    const r = await runTool("set_voice", { engine: "say", say_voice: "amelie", rate: 160 }, ctxWith(f.app));
    expect(r.ok).toBe(true);
    expect(f.get()).toMatchObject({ ttsEngine: "say", ttsVoice: "Amélie", ttsRate: 160 });
    expect(r.output).toContain("Piper local prêt.");
  });

  it("choisit une voix Piper installée par son nom, avec un chemin résolu côté application", async () => {
    const f = fakeApp();
    const r = await runTool("set_voice", { engine: "piper", piper_voice: "upmc" }, ctxWith(f.app));
    expect(r.ok).toBe(true);
    expect(f.get().piperModel).toBe("/voices/fr_FR-upmc-medium.onnx");
  });

  it("n'accepte jamais un chemin ou une voix inconnue, ni un débit absurde", async () => {
    const f = fakeApp();
    const ctx = ctxWith(f.app);
    const bad = [{ piper_voice: "/etc/passwd" }, { piper_voice: "../../x" }, { say_voice: "Zorglub" }, { rate: 5 }, { rate: 9999 }, { engine: "cloud" }, {}];
    for (const args of bad) expect((await runTool("set_voice", args, ctx)).ok, JSON.stringify(args)).toBe(false);
    expect(f.applied).toHaveLength(0);
  });

  it("la liste des voix disponibles est donnée dans l'erreur", async () => {
    const f = fakeApp();
    const r = await runTool("set_voice", { say_voice: "Zorglub" }, ctxWith(f.app));
    expect(r.output).toContain("Thomas");
  });
});

describe("set_behavior", () => {
  it("change bonjour, phrase d'activation et écoute de suite", async () => {
    const f = fakeApp();
    const r = await runTool("set_behavior", { greet_on_launch: false, wake_phrase: "  ok   cris ", follow_up_seconds: 12 }, ctxWith(f.app));
    expect(r.ok).toBe(true);
    expect(f.get()).toMatchObject({ greetOnLaunch: false, wakePhrase: "ok cris", followUpSeconds: 12 });
  });

  it("borne les valeurs", async () => {
    const f = fakeApp();
    const ctx = ctxWith(f.app);
    for (const args of [{ follow_up_seconds: 1 }, { follow_up_seconds: 99 }, { wake_phrase: "a" }, { wake_phrase: "x".repeat(60) }, { greet_on_launch: "peut-être" }, {}]) {
      expect((await runTool("set_behavior", args, ctx)).ok, JSON.stringify(args)).toBe(false);
    }
    expect(f.applied).toHaveLength(0);
  });

  it("activer le mot d'activation demande une confirmation, refus = rien ne change", async () => {
    const f = fakeApp();
    const ctx = ctxWith(f.app);
    sb.host.answer = false;
    const refused = await runTool("set_behavior", { wake_word_enabled: true }, ctx);
    expect(refused.ok).toBe(false);
    expect(sb.host.confirms).toHaveLength(1);
    expect(f.get().wakeWordEnabled).toBe(false);
    sb.host.answer = true;
    const ok = await runTool("set_behavior", { wake_word_enabled: true }, ctx);
    expect(ok.ok).toBe(true);
    expect(f.get().wakeWordEnabled).toBe(true);
  });

  it("désactiver le mot d'activation ne demande rien ; un modèle Whisper absent est signalé", async () => {
    const f = fakeApp({ wakeProblem: async () => "Aucun modèle Whisper local trouvé." });
    const ctx = ctxWith(f.app);
    const on = await runTool("set_behavior", { wake_word_enabled: true }, ctx);
    expect(on.output).toContain("Aucun modèle Whisper");
    const off = await runTool("set_behavior", { wake_word_enabled: false }, ctx);
    expect(off.ok).toBe(true);
    expect(sb.host.confirms).toHaveLength(1);
  });

  it("ne touche à rien d'autre que les réglages prévus", async () => {
    const f = fakeApp();
    await runTool("set_behavior", { greet_on_launch: true, allowedRoots: ["/"], provider: "x", shortcut: "A" }, ctxWith(f.app));
    expect(Object.keys(f.applied[0] ?? {})).toEqual(["greetOnLaunch"]);
  });
});

describe("get_app_settings et indisponibilité", () => {
  it("décrit l'état courant et les voix", async () => {
    const f = fakeApp();
    const r = await runTool("get_app_settings", {}, ctxWith(f.app));
    expect(r.ok).toBe(true);
    expect(r.output).toContain("Thomas");
    expect(r.output).toContain("fr_FR-siwis-medium");
    expect(r.output).toContain("ocean");
  });

  it("sans AppControl : erreur claire", async () => {
    sb = makeSandbox();
    for (const name of ["get_app_settings", "set_voice", "set_theme", "set_behavior"]) {
      expect((await runTool(name, { rate: 150, preset: "ocean", greet_on_launch: true }, sb.ctx)).ok).toBe(false);
    }
  });
});

describe("pas d'auto-modification du code", () => {
  it("touchesProtected détecte le dossier, ses enfants et ses parents", () => {
    const prot = ["/repo/app"];
    expect(touchesProtected("/repo/app", prot)).toBe(true);
    expect(touchesProtected("/repo/app/src/x.ts", prot)).toBe(true);
    expect(touchesProtected("/repo", prot)).toBe(true);
    expect(touchesProtected("/repo/other", prot)).toBe(false);
    expect(touchesProtected("/repo/app-other/x", prot)).toBe(false);
    expect(touchesProtected("/x", undefined)).toBe(false);
  });

  it("write_file, move_file, trash_file, create_project et run_shell refusent le dossier de l'application", async () => {
    const f = fakeApp();
    sb = makeSandbox();
    const appDir = path.join(sb.root, "AlphaCris");
    fs.mkdirSync(path.join(appDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(appDir, "src", "main.ts"), "// code");
    const ctx: ToolContext = { ...sb.ctx, app: f.app, protectedPaths: [appDir], projectsRoot: appDir };

    const write = await runTool("write_file", { path: path.join(appDir, "src", "main.ts"), content: "pwned" }, ctx);
    const create = await runTool("write_file", { path: path.join(appDir, "nouveau.ts"), content: "x" }, ctx);
    const move = await runTool("move_file", { from: path.join(appDir, "src", "main.ts"), to: path.join(sb.root, "copie.ts") }, ctx);
    const trash = await runTool("trash_file", { path: path.join(appDir, "src") }, ctx);
    const project = await runTool("create_project", { name: "p", files: [{ path: "a.txt", content: "1" }] }, ctx);
    const shell = await runTool("run_shell", { command: "echo hi", cwd: appDir }, ctx);
    for (const r of [write, create, move, trash, project, shell]) {
      expect(r.ok).toBe(false);
      expect(r.output).toContain("code de l'application");
    }
    expect(fs.readFileSync(path.join(appDir, "src", "main.ts"), "utf8")).toBe("// code");
    expect(sb.host.confirms).toHaveLength(0);

    const other = await runTool("write_file", { path: path.join(sb.root, "ok.txt"), content: "ok" }, ctx);
    expect(other.ok).toBe(true);
    const read = await runTool("read_file", { path: path.join(appDir, "src", "main.ts") }, ctx);
    expect(read.ok).toBe(true);
  });

  it("le prompt système cadre les réglages, la limite du code et la confirmation parlée", async () => {
    const f = fakeApp();
    const prompt = systemPrompt(ctxWith(f.app));
    expect(prompt).toContain("set_voice");
    expect(prompt).toContain("set_theme");
    expect(prompt).toContain("JAMAIS le code");
    expect(prompt).toMatch(/Cursor/);
    expect(prompt).toContain("confirme en une phrase");
  });

  it("scénario : « parle moins vite » -> outil appliqué, confirmation dans la réponse", async () => {
    const f = fakeApp();
    const ctx = ctxWith(f.app);
    const replies: ChatMessage[] = [
      { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "set_voice", arguments: JSON.stringify({ rate: 150 }) } }] },
      { role: "assistant", content: "C'est fait, je parle plus lentement : 150 mots par minute." },
    ];
    const llm: LlmClient = { chat: async () => replies.shift()! };
    const out = await runAgent({ llm, ctx, prompt: "parle moins vite" });
    expect(f.get().ttsRate).toBe(150);
    expect(out.text).toContain("150");
  });
});

describe("thème côté interface", () => {
  it("convertit un hex en teinte/saturation et refuse le reste", () => {
    expect(hexToHsl("#ff0000")).toMatchObject({ h: 0, s: 100 });
    expect(hexToHsl("#00ff00")?.h).toBeCloseTo(120);
    expect(hexToHsl("#0000ff")?.h).toBeCloseTo(240);
    expect(hexToHsl("#808080")?.s).toBe(0);
    expect(hexToHsl("rouge")).toBeNull();
  });

  it("borne les variables CSS et retombe sur les valeurs d'origine si le réglage est corrompu", () => {
    const v = themeVars({ themeAccent: "n'importe quoi", themeAccent2: "#ABCDEF", themeBackground: "url(x)", themeGlass: 9, themeBorder: -3 });
    expect(v["--accent"]).toBe("#7c5cff");
    expect(v["--accent2"]).toBe("#abcdef");
    expect(v["--bg"]).toBe("#0c0d14");
    expect(v["--glass"]).toBe("100%");
    expect(v["--border"]).toBe("0");
  });

  it("l'orbe suit les couleurs du thème (gris = peu saturé)", () => {
    const def = orbColors(DEFAULT_THEME);
    expect(def.hueA).toBeGreaterThan(240);
    expect(def.sat).toBe(1);
    const gris = orbColors({ ...DEFAULT_THEME, themeAccent: "#9aa3b5", themeAccent2: "#e4e8f0" });
    expect(gris.sat).toBeLessThan(0.4);
    const p = palettesFor(10, 100);
    expect(p.idle).toEqual({ a: 10, b: 100 });
    expect(p.thinking.b).toBe(38);
  });
});
