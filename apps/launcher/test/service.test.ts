import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keyFromEnv, getProvider } from "../src/core/llm";
import { LauncherService, llmSecretName, type SecretStore } from "../src/core/service";
import { defaultSettings, HistoryStore, SettingsStore, type Settings } from "../src/core/settings";
import { transcribeAudio } from "../src/core/transcribe";
import type { CursorSdkLike } from "../src/core/cursor";
import type { LlmClient } from "../src/core/types";
import { makeSandbox } from "./helpers";

let sb: ReturnType<typeof makeSandbox>;
afterEach(() => sb?.cleanup());

function memorySecrets(initial: Record<string, string> = {}): SecretStore {
  const m = new Map(Object.entries(initial));
  return { get: (n) => m.get(n), set: (n, v) => void (v ? m.set(n, v) : m.delete(n)), available: () => true };
}

function makeService(opts: { env?: NodeJS.ProcessEnv; secrets?: SecretStore; llm?: LlmClient; answer?: boolean; provider?: string; model?: string; cursorSdk?: () => Promise<CursorSdkLike> } = {}) {
  sb = makeSandbox();
  sb.host.answer = opts.answer ?? true;
  let settings: Settings = { ...defaultSettings(sb.base), provider: opts.provider ?? "openai", model: opts.model ?? "", allowedRoots: [sb.root], projectsRoot: path.join(sb.root, "Projects") };
  const service = new LauncherService({
    getSettings: () => settings,
    updateSettings: (p) => (settings = { ...settings, ...p }),
    home: sb.base,
    secrets: opts.secrets ?? memorySecrets(),
    host: sb.host,
    env: opts.env ?? {},
    llmFactory: opts.llm ? () => opts.llm! : undefined,
    cursorSdk: opts.cursorSdk,
  });
  return { service, getSettings: () => settings };
}

describe("LauncherService", () => {
  it("clé API : variable d'environnement prioritaire, puis trousseau, jamais en dur", () => {
    const { service } = makeService({ env: { OPENAI_API_KEY: "env-key" }, secrets: memorySecrets({ [llmSecretName("openai")]: "kc-key" }) });
    expect(service.llmApiKey()).toBe("env-key");
    expect(service.llmKeySource()).toBe("env");
    const b = makeService({ secrets: memorySecrets({ [llmSecretName("openai")]: "kc-key" }) });
    expect(b.service.llmApiKey()).toBe("kc-key");
    expect(b.service.llmKeySource()).toBe("keychain");
    const c = makeService();
    expect(c.service.llmKeySource()).toBe("none");
    expect(keyFromEnv(getProvider("openai"), { LAUNCHER_API_KEY: "a", OPENAI_API_KEY: "b" })).toBe("a");
  });

  it("sans clé, l'exécution échoue avec un message clair (et le mode « par type » reste utilisable)", async () => {
    const { service } = makeService();
    await expect(service.runPrompt("salut", () => {})).rejects.toThrow(/clé API/);
    fs.writeFileSync(path.join(sb.root, "a.png"), "x");
    const { plan } = await service.planFolder(sb.root, "", "type");
    expect(plan.moves).toHaveLength(1);
  });

  it("mode dossier : aperçu sans modification, confirmation obligatoire, refus = rien ne bouge, puis undo", async () => {
    const { service } = makeService({ answer: false });
    fs.writeFileSync(path.join(sb.root, "a.png"), "x");
    fs.writeFileSync(path.join(sb.root, "b.pdf"), "y");
    const { id, plan } = await service.planFolder(sb.root, "", "type");
    expect(plan.moves).toHaveLength(2);
    expect(sb.host.confirms).toHaveLength(0);
    expect(fs.existsSync(path.join(sb.root, "a.png"))).toBe(true);

    await expect(service.applyFolderPlan(id)).rejects.toThrow("Refusé");
    expect(fs.existsSync(path.join(sb.root, "a.png"))).toBe(true);

    sb.host.answer = true;
    const res = await service.applyFolderPlan(id);
    expect(res.moved).toHaveLength(2);
    expect(fs.existsSync(path.join(sb.root, "Images/a.png"))).toBe(true);
    const undo = service.undoLastOrganize();
    expect(undo.moved).toHaveLength(2);
    expect(fs.existsSync(path.join(sb.root, "a.png"))).toBe(true);
    expect(() => service.undoLastOrganize()).toThrow();
  });

  it("dossier hors périmètre : autorisation explicite requise", async () => {
    const { service, getSettings } = makeService({ answer: false });
    fs.writeFileSync(path.join(sb.outside, "a.png"), "x");
    await expect(service.planFolder(sb.outside, "", "type")).rejects.toThrow("non autorisé");
    expect(getSettings().allowedRoots).toEqual([sb.root]);
    sb.host.answer = true;
    const { plan } = await service.planFolder(sb.outside, "", "type");
    expect(plan.moves).toHaveLength(1);
    expect(getSettings().allowedRoots).toContain(sb.outside);
    expect(fs.existsSync(path.join(sb.outside, "a.png"))).toBe(true);
  });

  it("refuse d'autoriser la racine du disque ou un fichier", async () => {
    const { service } = makeService();
    await expect(service.planFolder("/", "", "type")).rejects.toThrow();
    fs.writeFileSync(path.join(sb.outside, "f"), "x");
    await expect(service.planFolder(path.join(sb.outside, "f"), "", "type")).rejects.toThrow();
  });

  it("mode prompt : utilise le LLM pour planifier et exige une consigne", async () => {
    const llm: LlmClient = {
      async chat() {
        return { role: "assistant", content: '{"summary":"s","assignments":[{"name":"a.txt","dest":"Notes"}]}' };
      },
    };
    const { service } = makeService({ llm, env: { OPENAI_API_KEY: "k" } });
    fs.writeFileSync(path.join(sb.root, "a.txt"), "x");
    await expect(service.planFolder(sb.root, "  ", "prompt")).rejects.toThrow();
    const { plan } = await service.planFolder(sb.root, "range les notes", "prompt");
    expect(plan.moves[0].toRel).toBe("Notes/a.txt");
  });

  it("transcription : exige une clé, appelle Whisper avec multipart", async () => {
    const { service } = makeService();
    await expect(service.transcribe(new Uint8Array([1]), "audio/webm")).rejects.toThrow(/clé/);

    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ text: " bonjour le monde " }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await transcribeAudio(new Uint8Array([1, 2, 3]), "audio/webm;codecs=opus", {
      baseUrl: "https://api.test/v1",
      model: "whisper-1",
      apiKey: "k",
      fetchImpl,
    });
    expect(text).toBe("bonjour le monde");
    expect(captured!.url).toBe("https://api.test/v1/audio/transcriptions");
    expect(captured!.init.body).toBeInstanceOf(FormData);
    expect((captured!.init.body as FormData).get("model")).toBe("whisper-1");
  });
});

describe("stockage", () => {
  it("SettingsStore persiste, fusionne avec les défauts et applique des permissions 600", () => {
    sb = makeSandbox();
    const file = path.join(sb.base, "cfg", "settings.json");
    const s1 = new SettingsStore(file, sb.base);
    expect(s1.get().shortcut).toBe("Alt+Space");
    expect(s1.get().provider).toBe("cursor");
    s1.update({ shortcut: "Cmd+Shift+Space", allowedRoots: ["/a", "/a", " /b "] });
    const s2 = new SettingsStore(file, sb.base);
    expect(s2.get().shortcut).toBe("Cmd+Shift+Space");
    expect(s2.get().allowedRoots).toEqual(["/a", "/b"]);
    expect(s2.get().provider).toBe("cursor");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, "utf8")).not.toMatch(/api[-_]?key/i);
  });

  it("HistoryStore : dédoublonne, ordre chronologique, limite, effacement", () => {
    sb = makeSandbox();
    const file = path.join(sb.base, "h.json");
    const h = new HistoryStore(file);
    h.add("a");
    h.add("b");
    h.add("a");
    h.add("   ");
    expect(new HistoryStore(file).list()).toEqual(["b", "a"]);
    for (let i = 0; i < 150; i++) h.add(`p${i}`);
    expect(h.list()).toHaveLength(100);
    expect(h.list().at(-1)).toBe("p149");
    h.clear();
    expect(new HistoryStore(file).list()).toEqual([]);
  });

  it("HistoryStore tolère un fichier corrompu", () => {
    sb = makeSandbox();
    const file = path.join(sb.base, "h.json");
    fs.writeFileSync(file, "{{{");
    expect(new HistoryStore(file).list()).toEqual([]);
  });
});
