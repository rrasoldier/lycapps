import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Scope } from "../src/core/security";
import type { ToolContext } from "../src/core/tools";
import type { Host } from "../src/core/types";

export interface TestHost extends Host {
  confirms: Array<{ title: string; detail: string; risk: string }>;
  answer: boolean;
  opened: string[];
  trashed: string[];
}

export function makeHost(answer = true): TestHost {
  const h: TestHost = {
    confirms: [],
    answer,
    opened: [],
    trashed: [],
    async confirm(req) {
      h.confirms.push(req);
      return h.answer;
    },
    async openExternal(url) {
      h.opened.push(url);
    },
    async openApp(name) {
      h.opened.push(`app:${name}`);
    },
    async trash(p) {
      h.trashed.push(p);
    },
  };
  return h;
}

export function makeSandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "launcher-test-")));
  const root = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  const host = makeHost();
  const scope = new Scope({ allowedRoots: [root], home: base });
  const ctx: ToolContext = { scope, host, projectsRoot: path.join(root, "Projects") };
  return { base, root, outside, host, scope, ctx, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
