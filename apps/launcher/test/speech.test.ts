import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createSpeaker, listVoices, startSay } from "../src/main/speech";

const dirs: string[] = [];
function fakeSay(script: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "say-"));
  dirs.push(dir);
  const bin = path.join(dir, "say");
  fs.writeFileSync(bin, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  process.env.LAUNCHER_SAY = bin;
  return dir;
}

afterEach(() => {
  delete process.env.LAUNCHER_SAY;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("synthèse vocale du système", () => {
  it("passe la voix, le débit et la phrase sans interprétation par un shell", async () => {
    const dir = fakeSay(`printf '%s\\n' "$@" > "$(dirname "$0")/args.txt"`);
    await startSay("Bonjour; rm -rf /", "Amélie", 190).done;
    expect(fs.readFileSync(path.join(dir, "args.txt"), "utf8").split("\n").slice(0, -1)).toEqual(["-v", "Amélie", "-r", "190", "--", "Bonjour; rm -rf /"]);
  });

  it("remonte un échec de la commande", async () => {
    fakeSay("exit 3");
    await expect(startSay("x", undefined, undefined).done).rejects.toThrow(/code 3/);
  });

  it("kill() coupe la parole sans erreur", async () => {
    fakeSay("sleep 30");
    const h = startSay("long", undefined, undefined);
    h.kill();
    await expect(h.done).resolves.toBeUndefined();
  });

  it("le Speaker enchaîne les phrases puis s'arrête sur stop()", async () => {
    const dir = fakeSay(`printf '%s\\n' "$*" >> "$(dirname "$0")/log.txt"; sleep 0.2`);
    const speaker = createSpeaker();
    await speaker.speak("Première phrase. Deuxième phrase.");
    expect(fs.readFileSync(path.join(dir, "log.txt"), "utf8").trim().split("\n")).toHaveLength(2);
    const p = speaker.speak("Une. Deux. Trois. Quatre.");
    setTimeout(() => speaker.stop(), 100);
    await p;
    expect(fs.readFileSync(path.join(dir, "log.txt"), "utf8").trim().split("\n").length).toBeLessThan(6);
  });

  it("liste les voix à partir de `say -v ?`", async () => {
    fakeSay(`printf 'Amélie              fr_CA    # Bonjour\\nAlex                en_US    # Hello\\n'`);
    expect(await listVoices()).toEqual([{ name: "Amélie", locale: "fr_CA" }, { name: "Alex", locale: "en_US" }]);
  });
});
