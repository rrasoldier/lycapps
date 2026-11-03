import { describe, expect, it } from "vitest";
import {
  Speaker,
  cleanTranscript,
  interpretConfirmation,
  isEndPhrase,
  matchChoice,
  matchWake,
  parseSayVoices,
  pickFrenchVoice,
  plainForSpeech,
  splitSentences,
  type SpeechHandle,
} from "../src/core/voice";

describe("texte à dire", () => {
  it("retire le Markdown, les liens, les chemins et les emojis", () => {
    const md = "## Résultat\n\nVoici **3 fichiers** dans `Downloads` 🎉 :\n\n- /Users/riana/Documents/rapport.pdf\n- [la doc](https://exemple.fr/doc)\n- https://exemple.fr/long/lien";
    const out = plainForSpeech(md);
    expect(out).not.toMatch(/[*#`\[\]🎉]/);
    expect(out).toContain("3 fichiers");
    expect(out).toContain("rapport.pdf");
    expect(out).not.toContain("/Users");
    expect(out).toContain("la doc");
    expect(out).toContain("un lien");
  });

  it("n'énonce ni le code ni les tableaux : renvoie à l'écran", () => {
    const out = plainForSpeech("Voici la commande :\n\n```bash\nrm -rf /\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).not.toContain("rm -rf");
    expect(out).not.toContain("|");
    expect(out).toContain("Le code est affiché à l'écran.");
    expect(out).toContain("Le tableau est affiché à l'écran.");
  });

  it("raccourcit les longues réponses (quelques phrases) et le signale", () => {
    const long = Array.from({ length: 9 }, (_, i) => `Phrase numéro ${i + 1} de la réponse.`).join(" ");
    const out = plainForSpeech(long);
    expect(out).toContain("Phrase numéro 4");
    expect(out).not.toContain("Phrase numéro 5");
    expect(out.endsWith("Le reste est affiché à l'écran.")).toBe(true);
  });

  it("découpe en phrases sans casser les décimaux, et coupe les phrases interminables", () => {
    expect(splitSentences("Il fait 3.5 degrés. Et alors ? Très bien !")).toEqual(["Il fait 3.5 degrés.", "Et alors ?", "Très bien !"]);
    const monster = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(", ");
    for (const part of splitSentences(monster, 100)) expect(part.length).toBeLessThanOrEqual(100);
  });
});

describe("synthèse vocale (Speaker)", () => {
  function fakeStarter(opts: { failVoice?: boolean; hold?: boolean } = {}) {
    const calls: Array<{ text: string; voice?: string }> = [];
    const killed: string[] = [];
    const starter = (text: string, voice?: string): SpeechHandle => {
      calls.push({ text, voice });
      let reject: (e: Error) => void = () => {};
      let resolve: () => void = () => {};
      const done = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      if (opts.failVoice && voice) setTimeout(() => reject(new Error("voix introuvable")), 0);
      else if (!opts.hold) setTimeout(resolve, 0);
      return {
        done,
        kill() {
          killed.push(text);
          reject(new Error("tué"));
        },
      };
    };
    return { starter, calls, killed };
  }

  it("dit les phrases une à une, dans l'ordre", async () => {
    const f = fakeStarter();
    const speaker = new Speaker(f.starter);
    await speaker.speak("Bonjour. Comment ça va ?", { voice: "Amélie", rate: 190 });
    expect(f.calls.map((c) => c.text)).toEqual(["Bonjour.", "Comment ça va ?"]);
    expect(f.calls[0].voice).toBe("Amélie");
    expect(speaker.speaking).toBe(false);
  });

  it("stop() coupe la phrase en cours et abandonne la suite, sans erreur", async () => {
    const f = fakeStarter({ hold: true });
    const speaker = new Speaker(f.starter);
    const p = speaker.speak("Une. Deux. Trois.");
    await new Promise((r) => setTimeout(r, 5));
    expect(speaker.speaking).toBe(true);
    speaker.stop();
    await p;
    expect(f.calls).toHaveLength(1);
    expect(f.killed).toEqual(["Une."]);
    expect(speaker.speaking).toBe(false);
  });

  it("voix absente : repli sur la voix par défaut, mémorisé", async () => {
    const f = fakeStarter({ failVoice: true });
    const speaker = new Speaker(f.starter);
    await speaker.speak("Salut. Ça va.", { voice: "Inconnue" });
    expect(f.calls.map((c) => c.voice)).toEqual(["Inconnue", undefined, undefined]);
  });

  it("une nouvelle demande remplace la précédente", async () => {
    const f = fakeStarter({ hold: true });
    const speaker = new Speaker(f.starter);
    const first = speaker.speak("Premier. Encore.");
    await new Promise((r) => setTimeout(r, 5));
    const second = speaker.speak("Second.");
    await first;
    expect(f.killed).toEqual(["Premier."]);
    speaker.stop();
    await second;
  });

  it("analyse `say -v ?` et choisit une voix française", () => {
    const out = [
      "Alex                en_US    # Most people recognize me by my voice.",
      "Thomas              fr_FR    # Bonjour, je m'appelle Thomas.",
      "Amélie              fr_CA    # Bonjour, je m'appelle Amélie.",
      "Eddy (français (France)) fr_FR    # Bonjour, je m'appelle Eddy.",
    ].join("\n");
    const voices = parseSayVoices(out);
    expect(voices).toHaveLength(4);
    expect(voices[3]).toEqual({ name: "Eddy (français (France))", locale: "fr_FR" });
    expect(pickFrenchVoice(voices)).toBe("Amélie");
    expect(pickFrenchVoice(voices, "Thomas")).toBe("Thomas");
    expect(pickFrenchVoice(voices, "Inexistante")).toBe("Amélie");
    expect(pickFrenchVoice([{ name: "Alex", locale: "en_US" }])).toBeUndefined();
  });
});

describe("confirmation vocale stricte", () => {
  it.each(["oui", "Oui, vas-y !", "d'accord", "ok", "bien sûr", "pas de souci, go", "je confirme", "Ouais fais-le"])("accepte « %s »", (t) => {
    expect(interpretConfirmation(t)).toBe("yes");
  });

  it.each(["non", "non ne le fais pas", "oui mais attends", "pas du tout", "annule", "stop", "laisse tomber", "peut-être", "euh", "", "il fait beau"])("refuse « %s »", (t) => {
    expect(interpretConfirmation(t)).toBe("no");
  });

  it("une réponse absente vaut refus", () => {
    expect(interpretConfirmation(null)).toBe("no");
    expect(interpretConfirmation(undefined)).toBe("no");
  });
});

describe("choix à voix haute", () => {
  const choices = ["CSV", "Excel", "Google Sheets"];
  it("par numéro, rang ou nom", () => {
    expect(matchChoice("le deuxième", choices)).toBe(1);
    expect(matchChoice("premier", choices)).toBe(0);
    expect(matchChoice("trois", choices)).toBe(2);
    expect(matchChoice("option 2", choices)).toBe(1);
    expect(matchChoice("Excel", choices)).toBe(1);
    expect(matchChoice("je prends le csv", choices)).toBe(0);
    expect(matchChoice("google sheets s'il te plaît", choices)).toBe(2);
  });
  it("renvoie -1 quand rien ne correspond ou si c'est ambigu", () => {
    expect(matchChoice("autre chose", choices)).toBe(-1);
    expect(matchChoice("septième", choices)).toBe(-1);
    expect(matchChoice("quatre", choices)).toBe(-1);
    expect(matchChoice("", choices)).toBe(-1);
    expect(matchChoice("fichier", ["fichier A", "fichier B"])).toBe(-1);
  });
});

describe("mot d'activation et fin de conversation", () => {
  it("détecte « hey cursor » avec les variantes de Whisper et renvoie la suite", () => {
    expect(matchWake("Hey Cursor, range mes téléchargements", "hey cursor")).toEqual({ matched: true, rest: "range mes téléchargements" });
    expect(matchWake("Hé curseur ouvre Safari", "hey cursor")).toEqual({ matched: true, rest: "ouvre Safari" });
    expect(matchWake("Ok Cursor", "hey cursor")).toEqual({ matched: true, rest: "" });
    expect(matchWake("Et, Cursor ? Tu m'entends", "hey cursor").matched).toBe(true);
  });
  it("ignore le reste (conversation ambiante)", () => {
    expect(matchWake("Il faut que je règle le curseur de la souris", "hey cursor").matched).toBe(false);
    expect(matchWake("Bonjour tout le monde", "hey cursor").matched).toBe(false);
    expect(matchWake("", "hey cursor").matched).toBe(false);
  });
  it("accepte une phrase personnalisée", () => {
    expect(matchWake("Jarvis allume la lumière", "jarvis")).toEqual({ matched: true, rest: "allume la lumière" });
    expect(matchWake("Hey Riana, bonjour", "hey riana").matched).toBe(true);
  });
  it("fin de conversation : seulement les phrases courtes", () => {
    expect(isEndPhrase("C'est bon, merci")).toBe(true);
    expect(isEndPhrase("Stop")).toBe(true);
    expect(isEndPhrase("merci beaucoup")).toBe(true);
    expect(isEndPhrase("merci de ranger mes fichiers du dossier téléchargements par année")).toBe(false);
    expect(isEndPhrase("range mes fichiers")).toBe(false);
  });
});

describe("nettoyage des transcriptions", () => {
  it("retire les annotations et les phrases inventées sur du silence", () => {
    expect(cleanTranscript(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanTranscript("(musique)")).toBe("");
    expect(cleanTranscript("♪ ♪")).toBe("");
    expect(cleanTranscript("Sous-titres réalisés par la communauté d'Amara.org")).toBe("");
    expect(cleanTranscript("Merci d'avoir regardé cette vidéo !")).toBe("");
    expect(cleanTranscript("Liste mes fichiers [musique]")).toBe("Liste mes fichiers");
    expect(cleanTranscript("a")).toBe("");
  });
});
