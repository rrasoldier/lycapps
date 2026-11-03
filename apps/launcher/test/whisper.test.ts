import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeRunner, type Runner } from "../src/core/updater";
import { defaultModelPath, findModel, localWhisperStatus, resolveWhisperBin, transcribeLocal } from "../src/core/whisper";
import { LauncherService, VOICE_PREFIX, type SecretStore } from "../src/core/service";
import { defaultSettings, type Settings } from "../src/core/settings";
import type { LlmClient } from "../src/core/types";
import { makeSandbox } from "./helpers";

let tmp: string;
afterEach(() => tmp && fs.rmSync(tmp, { recursive: true, force: true }));

function fixture() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-whisper-"));
  const model = path.join(tmp, "ggml-test.bin");
  fs.writeFileSync(model, "modèle factice");
  return { model };
}

function fakeRunner(reply: { code?: number; stdout?: string; stderr?: string }) {
  const calls: Array<{ cmd: string; args: string[]; wavBytes?: number }> = [];
  const run: Runner = async (cmd, args) => {
    const f = args[args.indexOf("-f") + 1];
    calls.push({ cmd, args, wavBytes: f && fs.existsSync(f) ? fs.statSync(f).size : undefined });
    return { code: reply.code ?? 0, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
  };
  return { run, calls };
}

describe("whisper.cpp local", () => {
  it("transcrit via le binaire, avec le bon modèle et la langue, puis efface le fichier temporaire", async () => {
    const { model } = fixture();
    const { run, calls } = fakeRunner({ stdout: " Bonjour le monde.\n\n Deuxième ligne.\n" });
    const text = await transcribeLocal(new Uint8Array(1000), { bin: "/usr/bin/whisper-cli", model }, run, tmp);
    expect(text).toBe("Bonjour le monde. Deuxième ligne.");
    expect(calls[0].cmd).toBe("/usr/bin/whisper-cli");
    expect(calls[0].args).toEqual(expect.arrayContaining(["-m", model, "-l", "fr", "-nt"]));
    expect(calls[0].wavBytes).toBe(1000);
    expect(fs.readdirSync(tmp).filter((n) => n.startsWith("launcher-stt-"))).toHaveLength(0);
  });

  it("messages clairs : modèle absent, binaire absent, échec du programme (et nettoyage)", async () => {
    const { model } = fixture();
    await expect(transcribeLocal(new Uint8Array(10), { bin: "x", model: path.join(tmp, "absent.bin") }, fakeRunner({}).run, tmp)).rejects.toThrow(/Modèle Whisper local introuvable[\s\S]*voice:install/);
    await expect(transcribeLocal(new Uint8Array(10), { bin: "", model }, fakeRunner({ code: 127, stderr: "zsh: command not found: whisper-cli" }).run, tmp)).rejects.toThrow(/brew install whisper-cpp/);
    await expect(transcribeLocal(new Uint8Array(10), { bin: "x", model }, fakeRunner({ code: 1, stderr: "boom\nerreur fatale" }).run, tmp)).rejects.toThrow(/échoué : boom erreur fatale/);
    expect(fs.readdirSync(tmp).filter((n) => n.startsWith("launcher-stt-"))).toHaveLength(0);
  });

  it("statut : prêt, modèle manquant, binaire manquant", async () => {
    const { model } = fixture();
    const ok = await localWhisperStatus({ bin: process.execPath, model }, makeRunner());
    expect(ok.ready).toBe(true);
    expect((await localWhisperStatus({ bin: "x", model: "" }, makeRunner())).detail).toContain("voice:install");
    expect((await localWhisperStatus({ bin: "x", model: path.join(tmp, "nope") }, makeRunner())).ready).toBe(false);
    const noBin = await localWhisperStatus({ bin: "whisper-cli-inexistant-xyz", model }, makeRunner());
    expect(noBin.ready).toBe(false);
    expect(noBin.detail).toContain("brew install whisper-cpp");
  });

  it("détection du binaire et du modèle par défaut", () => {
    expect(resolveWhisperBin("/mon/whisper")).toBe("/mon/whisper");
    expect(resolveWhisperBin("", (p) => p.startsWith("/opt/homebrew"))).toBe("/opt/homebrew/bin/whisper-cli");
    expect(resolveWhisperBin("", () => false)).toBe("whisper-cli");
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-whisper-"));
    expect(findModel(tmp)).toBeNull();
    fs.mkdirSync(path.dirname(defaultModelPath(tmp)), { recursive: true });
    fs.writeFileSync(defaultModelPath(tmp, "ggml-base.bin"), "x");
    expect(findModel(tmp)).toBe(defaultModelPath(tmp, "ggml-base.bin"));
    fs.writeFileSync(defaultModelPath(tmp, "ggml-small.bin"), "x");
    expect(findModel(tmp)).toBe(defaultModelPath(tmp, "ggml-small.bin"));
  });

  const realBin = process.env.WHISPER_BIN;
  const realModel = process.env.WHISPER_MODEL;
  const realWav = process.env.WHISPER_SAMPLE;
  it.skipIf(!realBin || !realModel || !realWav)("(optionnel) vrai whisper.cpp sur un échantillon audio", async () => {
    const text = await transcribeLocal(fs.readFileSync(realWav!), { bin: realBin!, model: realModel! }, makeRunner());
    expect(text.length).toBeGreaterThan(5);
    expect(text).not.toContain("read_audio_data");
  });
});

function memorySecrets(initial: Record<string, string> = {}): SecretStore {
  const m = new Map(Object.entries(initial));
  return { get: (n) => m.get(n), set: (n, v) => void (v ? m.set(n, v) : m.delete(n)), available: () => true };
}

describe("service : transcription et mode vocal", () => {
  function makeService(opts: { settings?: Partial<Settings>; env?: NodeJS.ProcessEnv; run?: Runner; fetchImpl?: typeof fetch; llm?: LlmClient } = {}) {
    const sb = makeSandbox();
    tmp = sb.base;
    const settings: Settings = { ...defaultSettings(sb.base), provider: "openai", allowedRoots: [sb.root], projectsRoot: path.join(sb.root, "Projects"), ...opts.settings };
    const service = new LauncherService({
      getSettings: () => settings,
      updateSettings: (p) => Object.assign(settings, p),
      home: sb.base,
      secrets: memorySecrets(),
      host: sb.host,
      env: opts.env ?? {},
      run: opts.run,
      fetchImpl: opts.fetchImpl,
      llmFactory: opts.llm ? () => opts.llm! : undefined,
    });
    return { service, sb };
  }
  const apiFetch = (async () => new Response(JSON.stringify({ text: "via api" }))) as unknown as typeof fetch;

  it("auto : whisper local si un modèle est installé, sinon l'API", async () => {
    const a = makeService({ env: { OPENAI_API_KEY: "k" }, fetchImpl: apiFetch });
    expect(await a.service.transcribe(new Uint8Array(10), "audio/wav")).toBe("via api");

    const model = path.join(a.sb.base, "m.bin");
    fs.writeFileSync(model, "x");
    const { run } = fakeRunner({ stdout: " via local\n" });
    const b = makeService({ settings: { whisperModel: model }, env: { OPENAI_API_KEY: "k" }, fetchImpl: apiFetch, run });
    expect(await b.service.transcribe(new Uint8Array(10), "audio/wav")).toBe("via local");
  });

  it("auto : si le local échoue, repli sur l'API ; en mode local, l'erreur remonte ; localOnly n'appelle jamais l'API", async () => {
    const failing = fakeRunner({ code: 1, stderr: "kaboom" }).run;
    const base = makeService();
    const model = path.join(base.sb.base, "m.bin");
    fs.writeFileSync(model, "x");
    const auto = makeService({ settings: { whisperModel: model }, env: { OPENAI_API_KEY: "k" }, fetchImpl: apiFetch, run: failing });
    expect(await auto.service.transcribe(new Uint8Array(10), "audio/wav")).toBe("via api");

    const forced = makeService({ settings: { whisperModel: model, sttEngine: "local" }, env: { OPENAI_API_KEY: "k" }, fetchImpl: apiFetch, run: failing });
    await expect(forced.service.transcribe(new Uint8Array(10), "audio/wav")).rejects.toThrow(/échoué/);

    let apiCalls = 0;
    const spy = (async () => {
      apiCalls++;
      return new Response(JSON.stringify({ text: "x" }));
    }) as unknown as typeof fetch;
    const wake = makeService({ settings: { whisperModel: "" }, env: { OPENAI_API_KEY: "k" }, fetchImpl: spy });
    await expect(wake.service.transcribe(new Uint8Array(10), "audio/wav", { localOnly: true })).rejects.toThrow(/Modèle Whisper local introuvable/);
    expect(apiCalls).toBe(0);
  });

  it("sans moteur : message explicite avec les deux solutions", async () => {
    const { service } = makeService();
    await expect(service.transcribe(new Uint8Array(10), "audio/wav")).rejects.toThrow(/voice:install[\s\S]*OPENAI_API_KEY/);
  });

  it("statut des moteurs", async () => {
    const { service } = makeService({ env: { OPENAI_API_KEY: "k" } });
    const st = await service.sttStatus();
    expect(st.api).toBe(true);
    expect(st.local.ready).toBe(false);
    expect(st.engine).toBe("auto");
  });

  it("demande dictée : consigne « mode vocal » ajoutée, absente en mode texte", async () => {
    const seen: string[] = [];
    const llm: LlmClient = {
      async chat(messages) {
        seen.push(String(messages.at(-1)?.content));
        return { role: "assistant", content: "ok" };
      },
    };
    const { service } = makeService({ env: { OPENAI_API_KEY: "k" }, llm });
    await service.runPrompt("range mes fichiers", () => {}, { voice: true });
    await service.runPrompt("et maintenant ?", () => {});
    expect(seen[0]).toBe(`${VOICE_PREFIX}range mes fichiers`);
    expect(seen[1]).toBe("et maintenant ?");
  });
});
