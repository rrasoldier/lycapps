import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAgent } from "../src/core/agent";
import { OpenAiCompatClient } from "../src/core/llm";
import type { AgentEvent, ChatMessage, LlmClient } from "../src/core/types";
import { makeSandbox } from "./helpers";

let sb: ReturnType<typeof makeSandbox>;
afterEach(() => sb?.cleanup());

function scripted(replies: ChatMessage[]): LlmClient & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    async chat(messages) {
      seen.push(JSON.parse(JSON.stringify(messages)));
      const next = replies.shift();
      if (!next) throw new Error("plus de réponses scriptées");
      return next;
    },
  };
}

const call = (id: string, name: string, args: unknown): ChatMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } }],
});

describe("runAgent", () => {
  it("enchaîne appel d'outil puis réponse finale", async () => {
    sb = makeSandbox();
    fs.writeFileSync(path.join(sb.root, "note.txt"), "42");
    const llm = scripted([call("1", "read_file", { path: "note.txt" }), { role: "assistant", content: "Le fichier contient 42." }]);
    const events: AgentEvent[] = [];
    const out = await runAgent({ llm, ctx: sb.ctx, prompt: "lis note.txt", onEvent: (e) => events.push(e) });
    expect(out.text).toBe("Le fichier contient 42.");
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result", "message"]);
    const toolMsg = llm.seen[1].at(-1)!;
    expect(toolMsg).toMatchObject({ role: "tool", tool_call_id: "1" });
    expect(toolMsg.content).toContain("42");
  });

  it("renvoie les erreurs d'outil au modèle (arguments invalides, périmètre)", async () => {
    sb = makeSandbox();
    const llm = scripted([
      call("1", "read_file", "{pas du json"),
      call("2", "read_file", { path: "/etc/passwd" }),
      { role: "assistant", content: "ok" },
    ]);
    await runAgent({ llm, ctx: sb.ctx, prompt: "x" });
    const last = llm.seen[2];
    expect(last.at(-1)!.content).toContain("Accès refusé");
    expect(last.at(-3)!.content).toContain("ERREUR");
  });

  it("une confirmation refusée n'exécute pas l'action", async () => {
    sb = makeSandbox();
    sb.host.answer = false;
    const marker = path.join(sb.root, "boom");
    const llm = scripted([call("1", "run_shell", { command: `touch ${marker}` }), { role: "assistant", content: "refusé" }]);
    await runAgent({ llm, ctx: sb.ctx, prompt: "x" });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("s'arrête après le nombre maximal d'étapes", async () => {
    sb = makeSandbox();
    const loop = Array.from({ length: 5 }, (_, i) => call(String(i), "list_files", { path: "." }));
    const events: AgentEvent[] = [];
    const out = await runAgent({ llm: scripted(loop), ctx: sb.ctx, prompt: "x", maxSteps: 3, onEvent: (e) => events.push(e) });
    expect(out.text).toContain("limite");
    expect(events.at(-1)?.type).toBe("error");
  });

  it("respecte l'annulation", async () => {
    sb = makeSandbox();
    const ac = new AbortController();
    ac.abort();
    await expect(runAgent({ llm: scripted([]), ctx: sb.ctx, prompt: "x", signal: ac.signal })).rejects.toThrow("Annulé");
  });
});

describe("OpenAiCompatClient", () => {
  it("envoie la requête attendue avec la clé en Authorization", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "salut" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new OpenAiCompatClient({ baseUrl: "https://x.test/v1/", model: "m", apiKey: "sk-secret", fetchImpl });
    const reply = await client.chat([{ role: "user", content: "hi" }], { json: true });
    expect(reply.content).toBe("salut");
    expect(captured!.url).toBe("https://x.test/v1/chat/completions");
    expect((captured!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-secret");
    expect(JSON.parse(captured!.init.body as string)).toMatchObject({ model: "m", response_format: { type: "json_object" } });
  });

  it("n'inclut pas la clé dans le message d'erreur et signale les statuts HTTP", async () => {
    const fetchImpl = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
    const client = new OpenAiCompatClient({ baseUrl: "https://x.test/v1", model: "m", apiKey: "sk-secret", fetchImpl });
    const err = await client.chat([]).catch((e: Error) => e);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("sk-secret");
  });
});
