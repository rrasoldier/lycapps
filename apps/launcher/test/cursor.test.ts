import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CURSOR_DEFAULT_MODEL,
  nodeSupportsCursorSdk,
  type CursorAgentOptions,
  type CursorCustomTool,
  type CursorRunLike,
  type CursorSdkLike,
} from "../src/core/cursor";
import { getProvider } from "../src/core/llm";
import { LauncherService, llmSecretName, type SecretStore } from "../src/core/service";
import { defaultSettings, type Settings } from "../src/core/settings";
import { TOOL_NAMES } from "../src/core/tools";
import type { AgentEvent } from "../src/core/types";
import { makeSandbox } from "./helpers";

let sb: ReturnType<typeof makeSandbox>;
afterEach(() => sb?.cleanup());

interface FakeState {
  created: CursorAgentOptions[];
  prompts: string[];
  closed: number;
  cancelled: number;
}

/** Faux SDK : `script` joue le rôle du modèle et peut appeler les outils exposés. */
function fakeSdk(
  script: (tools: Record<string, CursorCustomTool>, prompt: string) => Promise<string>,
  opts: { status?: "finished" | "error"; hang?: boolean } = {},
) {
  const state: FakeState = { created: [], prompts: [], closed: 0, cancelled: 0 };
  const sdk: CursorSdkLike = {
    Agent: {
      async create(options) {
        state.created.push(options);
        return {
          async send(prompt) {
            state.prompts.push(prompt);
            let release: () => void = () => {};
            const gate = new Promise<void>((r) => (release = r));
            const run: CursorRunLike = {
              async wait() {
                if (opts.hang) await gate;
                if (opts.status === "error") return { status: "error", error: { message: "quota dépassé" } };
                if (state.cancelled) return { status: "cancelled" };
                return { status: "finished", result: await script(options.local.customTools ?? {}, prompt) };
              },
              async cancel() {
                state.cancelled++;
                release();
              },
            };
            return run;
          },
          close() {
            state.closed++;
          },
        };
      },
    },
    Cursor: {
      models: {
        async list() {
          return [
            { id: "composer-2.5", displayName: "Composer 2.5" },
            { id: "claude-sonnet-x", displayName: "Claude Sonnet" },
          ];
        },
      },
    },
  };
  return { sdk, state };
}

function memorySecrets(initial: Record<string, string> = {}): SecretStore {
  const m = new Map(Object.entries(initial));
  return { get: (n) => m.get(n), set: (n, v) => void (v ? m.set(n, v) : m.delete(n)), available: () => true };
}

function makeService(opts: { sdk?: CursorSdkLike; env?: NodeJS.ProcessEnv; secrets?: SecretStore; answer?: boolean; model?: string } = {}) {
  sb = makeSandbox();
  sb.host.answer = opts.answer ?? true;
  let loaded = 0;
  let settings: Settings = {
    ...defaultSettings(sb.base),
    provider: "cursor",
    model: opts.model ?? "",
    allowedRoots: [sb.root],
    projectsRoot: path.join(sb.root, "Projects"),
  };
  const service = new LauncherService({
    getSettings: () => settings,
    updateSettings: (p) => (settings = { ...settings, ...p }),
    home: sb.base,
    secrets: opts.secrets ?? memorySecrets(),
    host: sb.host,
    env: opts.env ?? { CURSOR_API_KEY: "cursor_test_key" },
    cursorSdk: async () => {
      loaded++;
      if (!opts.sdk) throw new Error("SDK indisponible");
      return opts.sdk;
    },
  });
  return { service, loadedCount: () => loaded };
}

describe("fournisseur Cursor", () => {
  it("preset : clé CURSOR_API_KEY uniquement, modèle par défaut documenté", () => {
    const p = getProvider("cursor");
    expect(p.kind).toBe("cursor");
    expect(p.envKeys).toEqual(["CURSOR_API_KEY"]);
    expect(p.defaultModel).toBe(CURSOR_DEFAULT_MODEL);
  });

  it("clé : env CURSOR_API_KEY, puis trousseau propre au fournisseur ; jamais la clé d'un autre fournisseur", () => {
    const env = makeService({ env: { CURSOR_API_KEY: "c", OPENAI_API_KEY: "o", LAUNCHER_API_KEY: "l" } }).service;
    expect(env.llmApiKey()).toBe("c");
    expect(env.llmKeySource()).toBe("env");

    const kc = makeService({ env: {}, secrets: memorySecrets({ [llmSecretName("cursor")]: "kc" }) }).service;
    expect(kc.llmApiKey()).toBe("kc");
    expect(kc.llmKeySource()).toBe("keychain");

    const other = makeService({ env: { OPENAI_API_KEY: "o", LAUNCHER_API_KEY: "l" }, secrets: memorySecrets({ [llmSecretName("openai")]: "o2" }) }).service;
    expect(other.llmApiKey()).toBeUndefined();
    expect(other.llmKeySource()).toBe("none");
  });

  it("sans clé : erreur claire, SDK jamais chargé", async () => {
    const { service, loadedCount } = makeService({ env: {} });
    await expect(service.runPrompt("salut", () => {})).rejects.toThrow(/CURSOR_API_KEY/);
    await expect(service.listModels()).rejects.toThrow(/CURSOR_API_KEY/);
    expect(loadedCount()).toBe(0);
  });

  it("agent : aucun outil intégré (tools: ['mcp']), seulement nos outils, modèle par défaut, clé transmise", async () => {
    const { sdk, state } = fakeSdk(async () => "ok");
    const { service } = makeService({ sdk });
    await service.runPrompt("bonjour", () => {});
    const opts = state.created[0];
    expect(opts.apiKey).toBe("cursor_test_key");
    expect(opts.model).toEqual({ id: "composer-2.5" });
    expect(opts.tools).toEqual(["mcp"]);
    expect(Object.keys(opts.local.customTools ?? {}).sort()).toEqual([...TOOL_NAMES].sort());
    expect(state.prompts[0]).toContain("bonjour");
    expect(state.prompts[0]).toContain(sb.root);
    expect(state.closed).toBe(1);
  });

  it("modèle choisi dans les réglages (ex. un modèle Claude du catalogue)", async () => {
    const { sdk, state } = fakeSdk(async () => "ok");
    const { service } = makeService({ sdk, model: "claude-sonnet-x" });
    await service.runPrompt("x", () => {});
    expect(state.created[0].model.id).toBe("claude-sonnet-x");
  });

  it("les outils exposés passent par le périmètre et émettent des événements", async () => {
    const { sdk } = fakeSdk(async (tools) => {
      const ok = await tools.read_file.execute({ path: "n.txt" });
      const denied = await tools.read_file.execute({ path: "/etc/passwd" });
      expect(ok).toEqual({ content: [{ type: "text", text: "OK: 42" }], isError: false });
      expect(denied.isError).toBe(true);
      expect(denied.content[0].text).toContain("Accès refusé");
      return "fini";
    });
    const { service } = makeService({ sdk });
    fs.writeFileSync(path.join(sb.root, "n.txt"), "42");
    const events: AgentEvent[] = [];
    expect(await service.runPrompt("lis", (e) => events.push(e))).toBe("fini");
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "tool_call", "tool_result", "message"]);
  });

  it("la confirmation s'applique aussi via le SDK : shell refusé = rien d'exécuté", async () => {
    const marker = () => path.join(sb.root, "boom");
    const { sdk } = fakeSdk(async (tools) => {
      const r = await tools.run_shell.execute({ command: `touch ${marker()}` });
      expect(r.isError).toBe(true);
      return "refusé";
    });
    const { service } = makeService({ sdk, answer: false });
    await service.runPrompt("x", () => {});
    expect(fs.existsSync(marker())).toBe(false);
    expect(sb.host.confirms).toHaveLength(1);
    expect(sb.host.confirms[0].title).toContain("commande");
  });

  it("erreur du SDK remontée, agent fermé", async () => {
    const { sdk, state } = fakeSdk(async () => "", { status: "error" });
    const { service } = makeService({ sdk });
    await expect(service.runPrompt("x", () => {})).rejects.toThrow("quota dépassé");
    expect(state.closed).toBe(1);
  });

  it("annulation : run.cancel() appelé", async () => {
    const { sdk, state } = fakeSdk(async () => "jamais", { hang: true });
    const { service } = makeService({ sdk });
    const p = service.runPrompt("x", () => {});
    await new Promise((r) => setTimeout(r, 20));
    service.cancel();
    await expect(p).rejects.toThrow("Annulé");
    expect(state.cancelled).toBe(1);
    expect(state.closed).toBe(1);
  });

  it("mode dossier via Cursor : client texte sans outils, JSON demandé, plan construit et validé", async () => {
    const { sdk, state } = fakeSdk(async () => '{"summary":"s","assignments":[{"name":"a.txt","dest":"Notes"},{"name":"b.txt","dest":"../outside"}]}');
    const { service } = makeService({ sdk });
    fs.writeFileSync(path.join(sb.root, "a.txt"), "x");
    fs.writeFileSync(path.join(sb.root, "b.txt"), "y");
    const { plan } = await service.planFolder(sb.root, "range les notes", "prompt");
    expect(state.created[0].tools).toEqual([]);
    expect(state.created[0].local.customTools).toBeUndefined();
    expect(state.prompts[0]).toContain("JSON");
    expect(state.prompts[0]).toContain("a.txt");
    expect(plan.moves.map((m) => m.toRel)).toEqual(["Notes/a.txt"]);
    expect(plan.skipped.map((s) => s.name)).toEqual(["b.txt"]);
    expect(fs.existsSync(path.join(sb.root, "a.txt"))).toBe(true);
  });

  it("liste des modèles du catalogue", async () => {
    const { sdk } = fakeSdk(async () => "");
    const { service } = makeService({ sdk });
    expect((await service.listModels()).map((m) => m.id)).toEqual(["composer-2.5", "claude-sonnet-x"]);
  });

  it("version de Node requise par le SDK (>= 22.13)", () => {
    expect(nodeSupportsCursorSdk("22.13.0")).toBe(true);
    expect(nodeSupportsCursorSdk("22.22.0")).toBe(true);
    expect(nodeSupportsCursorSdk("24.0.0")).toBe(true);
    expect(nodeSupportsCursorSdk("22.12.9")).toBe(false);
    expect(nodeSupportsCursorSdk("20.18.0")).toBe(false);
  });
});
