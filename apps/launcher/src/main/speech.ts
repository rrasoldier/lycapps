import { execFile, spawn } from "node:child_process";
import { parseSayVoices, pickFrenchVoice, Speaker, type SpeechHandle, type SystemVoice } from "../core/voice";

/** Binaire de synthèse : `say` (macOS). `LAUNCHER_SAY` permet de le remplacer (tests, autre voix système). */
function sayBin(): string {
  return process.env.LAUNCHER_SAY || "say";
}

export function startSay(sentence: string, voice: string | undefined, rate: number | undefined): SpeechHandle {
  const args: string[] = [];
  if (voice) args.push("-v", voice);
  if (rate) args.push("-r", String(rate));
  args.push("--", sentence);
  const child = spawn(sayBin(), args, { stdio: "ignore" });
  let killed = false;
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (killed || code === 0 ? resolve() : reject(new Error(`say a échoué (code ${code})`))));
  });
  return {
    done,
    kill() {
      killed = true;
      child.kill("SIGTERM");
    },
  };
}

export function createSpeaker(start: (sentence: string, voice: string | undefined, rate: number | undefined) => SpeechHandle = startSay): Speaker {
  return new Speaker(start);
}

export function listVoices(): Promise<SystemVoice[]> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin" && !process.env.LAUNCHER_SAY) return resolve([]);
    execFile(sayBin(), ["-v", "?"], { timeout: 5000 }, (err, stdout) => resolve(err ? [] : parseSayVoices(stdout)));
  });
}

export async function resolveVoice(preferred: string): Promise<string | undefined> {
  if (preferred) return preferred;
  return pickFrenchVoice(await listVoices());
}
