import { describe, expect, it } from "vitest";
import { mergeLoginEnv, parseLoginEnv } from "../src/main/loginEnv";

describe("environnement du shell de connexion", () => {
  it("ignore le bruit avant les repères et lit le JSON", () => {
    const out = `Bienvenue !\n__ALPHACRIS_ENV_BEGIN__{"PATH":"/opt/homebrew/bin:/usr/bin","CURSOR_API_KEY":"k"}__ALPHACRIS_ENV_END__`;
    expect(parseLoginEnv(out)).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin", CURSOR_API_KEY: "k" });
  });

  it("renvoie null si la sortie est inutilisable", () => {
    expect(parseLoginEnv("rien")).toBeNull();
    expect(parseLoginEnv("__ALPHACRIS_ENV_BEGIN__{pas du json__ALPHACRIS_ENV_END__")).toBeNull();
  });

  it("complète PATH sans doublon et n'écrase jamais une variable existante", () => {
    const merged = mergeLoginEnv(
      { PATH: "/usr/bin:/bin", HOME: "/Users/a" },
      { PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/autre", OPENAI_API_KEY: "x", ELECTRON_RUN_AS_NODE: "1", SHLVL: "3" },
    );
    expect(merged).toEqual({ PATH: "/usr/bin:/bin:/opt/homebrew/bin", OPENAI_API_KEY: "x" });
  });
});

describe("importLoginEnv (shell réel)", () => {
  it("relit l'environnement via un shell de connexion", async () => {
    const { importLoginEnv } = await import("../src/main/loginEnv");
    delete process.env.ALPHACRIS_TEST_VAR;
    const before = process.env.PATH;
    expect(importLoginEnv(process.execPath, "/bin/sh")).toBe(true);
    expect(process.env.PATH).toContain((before ?? "").split(":")[0]);
  });
});
