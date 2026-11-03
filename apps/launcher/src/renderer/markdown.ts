/** Mini-analyseur Markdown sûr : produit un arbre (jamais de HTML brut), rendu ensuite via le DOM. */

export type Inline =
  | { t: "text"; text: string }
  | { t: "strong"; children: Inline[] }
  | { t: "em"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "link"; href: string; children: Inline[] };

export type Block =
  | { t: "heading"; level: number; inlines: Inline[] }
  | { t: "paragraph"; inlines: Inline[] }
  | { t: "code"; lang: string; text: string }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | { t: "table"; header: Inline[][]; rows: Inline[][][] }
  | { t: "quote"; inlines: Inline[] }
  | { t: "hr" };

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^`([^`\n]+)`/))) {
      flush();
      out.push({ t: "code", text: m[1] });
      i += m[0].length;
    } else if ((m = rest.match(/^\*\*([^\n]+?)\*\*/)) || (m = rest.match(/^__([^\n]+?)__/))) {
      flush();
      out.push({ t: "strong", children: parseInline(m[1]) });
      i += m[0].length;
    } else if ((m = rest.match(/^\*([^*\s][^*\n]*?)\*/)) || (m = rest.match(/^_([^_\s][^_\n]*?)_(?![\p{L}\p{N}])/u))) {
      flush();
      out.push({ t: "em", children: parseInline(m[1]) });
      i += m[0].length;
    } else if ((m = rest.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/))) {
      flush();
      out.push(SAFE_LINK.test(m[2]) ? { t: "link", href: m[2], children: parseInline(m[1]) } : { t: "text", text: m[1] });
      i += m[0].length;
    } else if ((m = rest.match(/^https?:\/\/[^\s<)]+/))) {
      flush();
      out.push({ t: "link", href: m[0], children: [{ t: "text", text: m[0] }] });
      i += m[0].length;
    } else {
      text += src[i];
      i++;
    }
  }
  flush();
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^```\s*([\w+-]*)\s*$/))) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ t: "code", lang: m[1], text: body.join("\n") });
    } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      blocks.push({ t: "heading", level: m[1].length, inlines: parseInline(m[2].trim()) });
      i++;
    } else if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
    } else if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ t: "table", header, rows });
    } else if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*•]\s+(.*)$/;
      const items: Inline[][] = [];
      while (i < lines.length && re.test(lines[i])) items.push(parseInline(lines[i++].match(re)![1]));
      blocks.push({ t: "list", ordered, items });
    } else if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", inlines: parseInline(q.join(" ")) });
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(```|#{1,4}\s|>\s?)/.test(lines[i]) &&
        !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])
      ) {
        para.push(lines[i++]);
      }
      if (para.length === 0) {
        para.push(lines[i++]);
      }
      blocks.push({ t: "paragraph", inlines: parseInline(para.join(" ").trim()) });
    }
  }
  return blocks;
}
