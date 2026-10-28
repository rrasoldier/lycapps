import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPlan,
  buildPlan,
  categoryFor,
  parseJsonObject,
  planByType,
  planWithLlm,
  scanFolder,
  undoMoves,
} from "../src/core/organizer";
import type { LlmClient } from "../src/core/types";
import { makeSandbox } from "./helpers";

let sb: ReturnType<typeof makeSandbox>;
afterEach(() => sb?.cleanup());

function fill(dir: string, names: string[]) {
  for (const n of names) fs.writeFileSync(path.join(dir, n), n);
}

describe("organizer", () => {
  it("categoryFor", () => {
    expect(categoryFor("a.PNG")).toBe("Images");
    expect(categoryFor("b.pdf")).toBe("Documents");
    expect(categoryFor("Makefile")).toBe("Autres");
    expect(categoryFor("x.zzz")).toBe("Autres");
  });

  it("scanFolder ignore les fichiers cachés et les dossiers", () => {
    sb = makeSandbox();
    fill(sb.root, ["a.png", ".hidden"]);
    fs.mkdirSync(path.join(sb.root, "sub"));
    expect(scanFolder(sb.root).map((f) => f.name)).toEqual(["a.png"]);
  });

  it("aperçu par type = dry-run : aucun fichier ne bouge", () => {
    sb = makeSandbox();
    fill(sb.root, ["a.png", "b.pdf", "c.zip", "d"]);
    const files = scanFolder(sb.root);
    const plan = buildPlan(sb.root, sb.scope, files, planByType(sb.root, files), "type");
    expect(plan.moves.map((m) => m.toRel).sort()).toEqual(["Archives/c.zip", "Autres/d", "Documents/b.pdf", "Images/a.png"]);
    expect(fs.readdirSync(sb.root).sort()).toEqual(["a.png", "b.pdf", "c.zip", "d"]);
  });

  it("applyPlan déplace sans supprimer ni écraser, undo remet en place", () => {
    sb = makeSandbox();
    fill(sb.root, ["a.png", "b.pdf"]);
    const files = scanFolder(sb.root);
    const plan = buildPlan(sb.root, sb.scope, files, planByType(sb.root, files), "type");
    const res = applyPlan(plan, sb.scope);
    expect(res.failed).toEqual([]);
    expect(fs.readFileSync(path.join(sb.root, "Images/a.png"), "utf8")).toBe("a.png");
    expect(fs.existsSync(path.join(sb.root, "a.png"))).toBe(false);
    const undo = undoMoves(res.moved, sb.scope);
    expect(undo.failed).toEqual([]);
    expect(fs.readdirSync(sb.root).sort()).toEqual(["a.png", "b.pdf"]);
  });

  it("applyPlan respecte la sélection partielle", () => {
    sb = makeSandbox();
    fill(sb.root, ["a.png", "b.pdf"]);
    const files = scanFolder(sb.root);
    const plan = buildPlan(sb.root, sb.scope, files, planByType(sb.root, files), "type");
    applyPlan(plan, sb.scope, new Set([path.join(sb.root, "a.png")]));
    expect(fs.existsSync(path.join(sb.root, "Images/a.png"))).toBe(true);
    expect(fs.existsSync(path.join(sb.root, "b.pdf"))).toBe(true);
  });

  it("buildPlan rejette traversée, chemin absolu, fichiers inconnus et collisions", () => {
    sb = makeSandbox();
    fill(sb.root, ["a.txt", "b.txt", "c.txt"]);
    fs.mkdirSync(path.join(sb.root, "Docs"));
    fill(path.join(sb.root, "Docs"), ["c.txt"]);
    const files = scanFolder(sb.root);
    const plan = buildPlan(
      sb.root,
      sb.scope,
      files,
      [
        { name: "a.txt", dest: "../outside" },
        { name: "b.txt", dest: "/etc" },
        { name: "ghost.txt", dest: "X" },
        { name: "c.txt", dest: "Docs" },
      ],
      "s",
    );
    expect(plan.moves.map((m) => m.toRel)).toEqual(["etc/b.txt"]); // "/etc" devient relatif au dossier, donc inoffensif
    expect(plan.skipped.map((s) => s.name).sort()).toEqual(["a.txt", "c.txt", "ghost.txt"]);
    expect(fs.existsSync(path.join(sb.outside, "a.txt"))).toBe(false);
  });

  it("applyPlan revérifie : une destination apparue entre-temps n'est pas écrasée", () => {
    sb = makeSandbox();
    fill(sb.root, ["a.png"]);
    const files = scanFolder(sb.root);
    const plan = buildPlan(sb.root, sb.scope, files, [{ name: "a.png", dest: "Images" }], "s");
    fs.mkdirSync(path.join(sb.root, "Images"));
    fs.writeFileSync(path.join(sb.root, "Images/a.png"), "AUTRE");
    const res = applyPlan(plan, sb.scope);
    expect(res.moved).toEqual([]);
    expect(res.failed).toHaveLength(1);
    expect(fs.readFileSync(path.join(sb.root, "Images/a.png"), "utf8")).toBe("AUTRE");
    expect(fs.existsSync(path.join(sb.root, "a.png"))).toBe(true);
  });

  it("planWithLlm construit un plan depuis la réponse JSON (même entourée de ```)", async () => {
    sb = makeSandbox();
    fill(sb.root, ["facture-2024.pdf", "photo.jpg"]);
    const llm: LlmClient = {
      async chat(messages, opts) {
        expect(opts?.json).toBe(true);
        expect(messages.at(-1)!.content).toContain("facture-2024.pdf");
        return {
          role: "assistant",
          content: '```json\n{"summary":"Par année","assignments":[{"name":"facture-2024.pdf","dest":"Factures/2024"}]}\n```',
        };
      },
    };
    const plan = await planWithLlm(llm, sb.root, sb.scope, scanFolder(sb.root), "range les factures par année");
    expect(plan.summary).toBe("Par année");
    expect(plan.moves.map((m) => m.toRel)).toEqual(["Factures/2024/facture-2024.pdf"]);
  });

  it("parseJsonObject échoue proprement", () => {
    expect(() => parseJsonObject("pas de json")).toThrow();
    expect(() => parseJsonObject("{oops}")).toThrow();
    expect(parseJsonObject('bla {"a":1} fin')).toEqual({ a: 1 });
  });
});
