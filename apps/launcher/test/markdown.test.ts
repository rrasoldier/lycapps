import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../src/renderer/markdown";

describe("markdown", () => {
  it("inline : gras, italique, code, liens sûrs uniquement", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      { t: "text", text: "a " },
      { t: "strong", children: [{ t: "text", text: "b" }] },
      { t: "text", text: " " },
      { t: "em", children: [{ t: "text", text: "c" }] },
      { t: "text", text: " " },
      { t: "code", text: "d" },
    ]);
    expect(parseInline("[ok](https://x.test)")[0]).toMatchObject({ t: "link", href: "https://x.test" });
    expect(parseInline("[mal](javascript:alert(1))").some((n) => n.t === "link")).toBe(false);
    expect(parseInline("voir https://a.test/x.")[1]).toMatchObject({ t: "link" });
  });

  it("ne traite jamais le HTML : tout reste du texte", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", text: "<img src=x onerror=alert(1)>" }]);
  });

  it("blocs : titres, listes, code, citation, séparateur", () => {
    const blocks = parseMarkdown("# Titre\n\nTexte **fort**\nsuite\n\n- un\n- deux\n\n1. a\n2. b\n\n```bash\nls -la\n```\n\n> cité\n\n---");
    expect(blocks.map((b) => b.t)).toEqual(["heading", "paragraph", "list", "list", "code", "quote", "hr"]);
    expect(blocks[3]).toMatchObject({ t: "list", ordered: true });
    expect(blocks[4]).toEqual({ t: "code", lang: "bash", text: "ls -la" });
    expect(blocks[1]).toMatchObject({ t: "paragraph" });
  });

  it("tableaux", () => {
    const [table] = parseMarkdown("| Mois | Total |\n| --- | ---: |\n| Jan | **10** |\n| Fév | 12 |");
    expect(table.t).toBe("table");
    if (table.t !== "table") return;
    expect(table.header).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][1][0]).toMatchObject({ t: "strong" });
  });

  it("bloc de code non fermé et texte vide ne plantent pas", () => {
    expect(parseMarkdown("```\nabc")).toEqual([{ t: "code", lang: "", text: "abc" }]);
    expect(parseMarkdown("")).toEqual([]);
  });
});
