import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTool, sanitizeProjectName, TOOL_NAMES } from "../src/core/tools";
import { makeSandbox } from "./helpers";

let sb: ReturnType<typeof makeSandbox>;
afterEach(() => sb?.cleanup());

describe("outils", () => {
  it("expose les outils attendus", () => {
    expect(TOOL_NAMES).toEqual(
      expect.arrayContaining(["list_files", "read_file", "write_file", "move_file", "trash_file", "run_shell", "open_app", "open_url", "create_project"]),
    );
  });

  it("list_files / read_file dans le périmètre, sans confirmation", async () => {
    sb = makeSandbox();
    fs.writeFileSync(path.join(sb.root, "a.txt"), "bonjour");
    const list = await runTool("list_files", { path: sb.root }, sb.ctx);
    expect(list.ok).toBe(true);
    expect(list.output).toContain("a.txt");
    const read = await runTool("read_file", { path: "a.txt" }, sb.ctx);
    expect(read).toEqual({ ok: true, output: "bonjour" });
    expect(sb.host.confirms).toHaveLength(0);
  });

  it("refuse la lecture hors périmètre", async () => {
    sb = makeSandbox();
    fs.writeFileSync(path.join(sb.outside, "s.txt"), "secret");
    const r = await runTool("read_file", { path: path.join(sb.outside, "s.txt") }, sb.ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("Accès refusé");
  });

  it("write_file crée sans confirmation, demande confirmation pour écraser", async () => {
    sb = makeSandbox();
    const f = path.join(sb.root, "n.txt");
    expect((await runTool("write_file", { path: f, content: "1" }, sb.ctx)).ok).toBe(true);
    expect(sb.host.confirms).toHaveLength(0);
    sb.host.answer = false;
    const refused = await runTool("write_file", { path: f, content: "2" }, sb.ctx);
    expect(refused.ok).toBe(false);
    expect(fs.readFileSync(f, "utf8")).toBe("1");
    expect(sb.host.confirms).toHaveLength(1);
    sb.host.answer = true;
    expect((await runTool("write_file", { path: f, content: "2" }, sb.ctx)).ok).toBe(true);
    expect(fs.readFileSync(f, "utf8")).toBe("2");
  });

  it("move_file demande confirmation et n'écrase jamais", async () => {
    sb = makeSandbox();
    fs.writeFileSync(path.join(sb.root, "a"), "A");
    fs.writeFileSync(path.join(sb.root, "b"), "B");
    const clash = await runTool("move_file", { from: "a", to: "b" }, sb.ctx);
    expect(clash.ok).toBe(false);
    expect(fs.readFileSync(path.join(sb.root, "b"), "utf8")).toBe("B");
    sb.host.answer = false;
    expect((await runTool("move_file", { from: "a", to: "sub/c" }, sb.ctx)).ok).toBe(false);
    expect(fs.existsSync(path.join(sb.root, "a"))).toBe(true);
    sb.host.answer = true;
    expect((await runTool("move_file", { from: "a", to: "sub/c" }, sb.ctx)).ok).toBe(true);
    expect(fs.existsSync(path.join(sb.root, "sub/c"))).toBe(true);
  });

  it("move_file refuse une destination hors périmètre", async () => {
    sb = makeSandbox();
    fs.writeFileSync(path.join(sb.root, "a"), "A");
    const r = await runTool("move_file", { from: "a", to: path.join(sb.outside, "a") }, sb.ctx);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(sb.root, "a"))).toBe(true);
  });

  it("trash_file : confirmation danger, Corbeille via l'hôte, pas de suppression si refus", async () => {
    sb = makeSandbox();
    const f = path.join(sb.root, "x");
    fs.writeFileSync(f, "x");
    sb.host.answer = false;
    expect((await runTool("trash_file", { path: f }, sb.ctx)).ok).toBe(false);
    expect(sb.host.trashed).toEqual([]);
    sb.host.answer = true;
    expect((await runTool("trash_file", { path: f }, sb.ctx)).ok).toBe(true);
    expect(sb.host.trashed).toEqual([f]);
    expect(sb.host.confirms.at(-1)?.risk).toBe("danger");
    expect((await runTool("trash_file", { path: sb.root }, sb.ctx)).ok).toBe(false);
  });

  it("run_shell : refus => rien n'est exécuté", async () => {
    sb = makeSandbox();
    sb.host.answer = false;
    const marker = path.join(sb.root, "ran");
    const r = await runTool("run_shell", { command: `touch ${marker}` }, sb.ctx);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
    expect(sb.host.confirms).toHaveLength(1);
  });

  it("run_shell : exécute après confirmation, dans le dossier autorisé", async () => {
    sb = makeSandbox();
    const r = await runTool("run_shell", { command: "pwd && echo salut" }, sb.ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain(sb.root);
    expect(r.output).toContain("salut");
  });

  it("run_shell : cwd hors périmètre refusé, commande dangereuse marquée danger", async () => {
    sb = makeSandbox();
    expect((await runTool("run_shell", { command: "ls", cwd: sb.outside }, sb.ctx)).ok).toBe(false);
    expect(sb.host.confirms).toHaveLength(0);
    sb.host.answer = false;
    await runTool("run_shell", { command: "rm -rf ." }, sb.ctx);
    expect(sb.host.confirms[0].risk).toBe("danger");
  });

  it("run_shell : code de sortie non nul = erreur, timeout respecté", async () => {
    sb = makeSandbox();
    const fail = await runTool("run_shell", { command: "echo oops >&2; exit 3" }, sb.ctx);
    expect(fail.ok).toBe(false);
    expect(fail.output).toContain("oops");
    const slow = await runTool("run_shell", { command: "sleep 5" }, { ...sb.ctx, shellTimeoutMs: 200 });
    expect(slow.ok).toBe(false);
    expect(slow.output).toContain("timeout");
  });

  it("open_url / open_app valident leurs entrées", async () => {
    sb = makeSandbox();
    expect((await runTool("open_url", { url: "https://example.com" }, sb.ctx)).ok).toBe(true);
    expect((await runTool("open_url", { url: "file:///etc/passwd" }, sb.ctx)).ok).toBe(false);
    expect((await runTool("open_app", { name: "Safari" }, sb.ctx)).ok).toBe(true);
    expect((await runTool("open_app", { name: "x; rm -rf /" }, sb.ctx)).ok).toBe(false);
    expect(sb.host.opened).toEqual(["https://example.com", "app:Safari"]);
  });

  it("create_project crée les fichiers après confirmation et protège contre la traversée", async () => {
    sb = makeSandbox();
    const ok = await runTool(
      "create_project",
      { name: "Mon App!", files: [{ path: "index.html", content: "<h1>hi</h1>" }, { path: "src/main.js", content: "1" }] },
      sb.ctx,
    );
    expect(ok.ok).toBe(true);
    const dir = path.join(sb.root, "Projects", "Mon-App");
    expect(fs.readFileSync(path.join(dir, "src/main.js"), "utf8")).toBe("1");
    expect(sb.host.confirms[0].detail).toContain("+ index.html");

    const again = await runTool("create_project", { name: "Mon App!", files: [{ path: "x", content: "" }] }, sb.ctx);
    expect(again.ok).toBe(false);

    for (const bad of ["../../evil.txt", "/tmp/evil.txt"]) {
      const r = await runTool("create_project", { name: "p2", files: [{ path: bad, content: "" }] }, sb.ctx);
      expect(r.ok).toBe(false);
    }
    expect(fs.existsSync(path.join(sb.root, "evil.txt"))).toBe(false);
  });

  it("create_project refusé => rien d'écrit", async () => {
    sb = makeSandbox();
    sb.host.answer = false;
    const r = await runTool("create_project", { name: "p", files: [{ path: "a", content: "" }] }, sb.ctx);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(sb.root, "Projects", "p"))).toBe(false);
  });

  it("ask_user : transmet question et choix (bornés), renvoie la réponse", async () => {
    sb = makeSandbox();
    sb.host.reply = "Option B";
    const r = await runTool("ask_user", { question: "Lequel ?", choices: ["A", " ", "Option B", "x".repeat(200)], allow_text: false }, sb.ctx);
    expect(r).toEqual({ ok: true, output: "Réponse de l'utilisatrice : Option B" });
    expect(sb.host.asks[0].choices).toEqual(["A", "Option B", "x".repeat(80)]);
    expect(sb.host.asks[0].allowText).toBe(false);
    expect(sb.host.confirms).toHaveLength(0);
  });

  it("ask_user : sans choix la réponse libre reste autorisée ; pas de réponse = erreur", async () => {
    sb = makeSandbox();
    await runTool("ask_user", { question: "Nom ?", allow_text: false }, sb.ctx);
    expect(sb.host.asks[0]).toMatchObject({ choices: [], allowText: true });
    sb.host.reply = null;
    const r = await runTool("ask_user", { question: "Encore ?" }, sb.ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("pas répondu");
  });

  it("outil inconnu / sanitizeProjectName", async () => {
    sb = makeSandbox();
    expect((await runTool("format_disk", {}, sb.ctx)).ok).toBe(false);
    expect(sanitizeProjectName("  ../Mon projet  ")).toBe("Mon-projet");
    expect(() => sanitizeProjectName("///")).toThrow();
  });
});
