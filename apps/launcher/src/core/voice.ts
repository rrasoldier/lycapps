/**
 * Briques « conversation vocale » indépendantes d'Electron : mise en forme du texte à dire, synthèse
 * vocale du système (`say` sur macOS), interprétation des réponses orales (oui/non, choix, mot
 * d'activation, fin de conversation) et nettoyage des transcriptions.
 *
 * Approche inspirée de « Jarvis maison » (sosoj92/jarvis-assistant-vocal, licence MIT) : parole phrase par
 * phrase et interruptible, réponses courtes à l'oral, confirmation vocale stricte (le moindre refus ou
 * doute annule), filtrage des « phrases fantômes » de Whisper. Le code est réécrit pour ce projet.
 */

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Minuscules, sans accents, ponctuation → espaces (« vas-y ! » → « vas y »). */
export function normalizeSpeech(text: string): string {
  return strip(text.toLowerCase().replace(/[’‘]/g, "'"))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ---------- Texte à dire ---------- */

export interface SpeechOptions {
  maxSentences?: number;
  maxChars?: number;
}

/**
 * Transforme une réponse Markdown en texte agréable à écouter : sans symboles, sans code, sans tableaux,
 * sans chemins interminables, et assez court (le détail reste affiché à l'écran).
 */
export function plainForSpeech(markdown: string, opts: SpeechOptions = {}): string {
  const maxSentences = opts.maxSentences ?? 4;
  const maxChars = opts.maxChars ?? 520;
  let hasCode = false;
  let hasTable = false;
  const lines: string[] = [];
  let inFence = false;
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) {
      if (!inFence) hasCode = true;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*\|.*\|\s*$/.test(raw) || /^\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*$/.test(raw)) {
      hasTable = true;
      continue;
    }
    let line = raw
      .replace(/^\s*#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*[-*•]\s+/, "")
      .replace(/^\s*\d+[.)]\s+/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "un lien")
      .replace(/(\*\*|__|\*|_|`)/g, "")
      .replace(/(?:~|\/)(?:[^\s/]+\/)+([^\s/]+)/g, "$1")
      .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    if (!/[.!?…:;]$/.test(line)) line += ".";
    lines.push(line);
  }
  let text = lines.join(" ").replace(/\s+([.!?…])/g, "$1").trim();
  const notes: string[] = [];
  if (hasCode) notes.push("Le code est affiché à l'écran.");
  if (hasTable) notes.push("Le tableau est affiché à l'écran.");

  const sentences = splitSentences(text);
  let kept = sentences.slice(0, maxSentences).join(" ");
  let truncated = sentences.length > maxSentences;
  if (kept.length > maxChars) {
    const cut = kept.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    kept = lastStop > maxChars * 0.4 ? cut.slice(0, lastStop + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
    truncated = true;
  }
  text = kept;
  if (truncated) notes.push("Le reste est affiché à l'écran.");
  return [text, ...notes].filter(Boolean).join(" ").trim();
}

/** Découpe en phrases (jamais au milieu d'un nombre décimal) ; une phrase très longue est coupée aux virgules. */
export function splitSentences(text: string, maxLen = 220): string[] {
  const out: string[] = [];
  for (const part of text.split(/(?<=[.!?…])\s+|\n+/)) {
    let rest = part.trim();
    while (rest.length > maxLen) {
      const cut = rest.lastIndexOf(", ", maxLen - 1);
      const at = cut > maxLen * 0.4 ? cut + 1 : rest.lastIndexOf(" ", maxLen);
      const idx = at > 0 ? at : maxLen;
      out.push(rest.slice(0, idx).trim());
      rest = rest.slice(idx).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/* ---------- Synthèse vocale du système ---------- */

export interface SpeechHandle {
  done: Promise<void>;
  kill(): void;
}

export type SpeechStarter = (sentence: string, voice: string | undefined, rate: number | undefined) => SpeechHandle;

/** File d'attente de phrases dites une à une ; `stop()` coupe net (utile pour interrompre l'assistant). */
export class Speaker {
  private current: SpeechHandle | null = null;
  private generation = 0;
  private voiceFailed = false;

  constructor(private readonly start: SpeechStarter) {}

  get speaking(): boolean {
    return this.current !== null;
  }

  /** Dit `markdown` (déjà ramené à du texte oral) et se résout à la fin, ou dès que `stop()` est appelé. */
  async speak(spoken: string, opts: { voice?: string; rate?: number } = {}): Promise<void> {
    this.stop();
    const gen = this.generation;
    for (const sentence of splitSentences(spoken)) {
      if (gen !== this.generation) return;
      await this.say(sentence, opts, gen);
    }
  }

  stop(): void {
    this.generation++;
    const handle = this.current;
    this.current = null;
    handle?.kill();
  }

  private async say(sentence: string, opts: { voice?: string; rate?: number }, gen: number): Promise<void> {
    const run = async (voice: string | undefined) => {
      const handle = this.start(sentence, voice, opts.rate);
      this.current = handle;
      try {
        await handle.done;
      } finally {
        if (this.current === handle) this.current = null;
      }
    };
    const fail = (e: unknown) => new Error(`Synthèse vocale impossible : ${e instanceof Error ? e.message : String(e)}`);
    const voice = this.voiceFailed ? undefined : opts.voice || undefined;
    try {
      await run(voice);
    } catch (err) {
      if (gen !== this.generation) return;
      if (!voice) throw fail(err);
      // Voix absente (non téléchargée) : repli sur la voix par défaut sans bloquer la conversation.
      this.voiceFailed = true;
      try {
        await run(undefined);
      } catch (e) {
        if (gen === this.generation) throw fail(e);
      }
    }
  }
}

export interface SystemVoice {
  name: string;
  locale: string;
}

/** Analyse la sortie de `say -v ?` (« Amélie   fr_CA    # Bonjour, je m'appelle Amélie. »). */
export function parseSayVoices(output: string): SystemVoice[] {
  const voices: SystemVoice[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^(.+?)\s+([a-z]{2,3}_[A-Za-z]{2,4})\s+#/);
    if (m) voices.push({ name: m[1].trim(), locale: m[2] });
  }
  return voices;
}

/** Voix par défaut : celle demandée si elle existe, sinon une voix française (Amélie, Thomas…), sinon rien. */
export function pickFrenchVoice(voices: SystemVoice[], preferred?: string): string | undefined {
  if (preferred && voices.some((v) => v.name === preferred)) return preferred;
  const french = voices.filter((v) => v.locale.startsWith("fr"));
  for (const wanted of ["Amélie", "Thomas", "Audrey"]) {
    const found = french.find((v) => v.name.startsWith(wanted));
    if (found) return found.name;
  }
  return french[0]?.name;
}

/* ---------- Réponses orales ---------- */

const AGREE = new Set(["oui", "ouais", "ouep", "yes", "ok", "okay", "confirme", "confirmer", "valide", "valider", "autorise", "autoriser", "parfait", "carrement", "go", "vas", "fais", "envoie", "daccord"]);
const AGREE_PHRASES = [" d accord ", " bien sur ", " c est bon ", " vas y ", " allez y ", " fais le ", " je confirme "];
const REFUSE = new Set(["non", "nan", "nope", "no", "pas", "jamais", "rien", "aucun", "aucune", "annule", "annuler", "annulez", "arrete", "arreter", "stop", "attends", "attend", "attendez", "refuse", "refuser", "surtout", "interdit"]);
const REFUSE_PHRASES = [" laisse tomber ", " plus tard ", " je sais pas ", " sais pas "];
const POSITIVE_IDIOMS = / pas de (?:souci|soucis|probleme|problemes) /;

/**
 * Une action n'est autorisée que sur un accord explicite : le moindre refus, hésitation ou propos sans
 * rapport vaut refus (« non, ne le fais pas », « attends » → non).
 */
export function interpretConfirmation(text: string | null | undefined): "yes" | "no" {
  if (!text) return "no";
  let plain = ` ${normalizeSpeech(text)} `;
  plain = plain.replace(POSITIVE_IDIOMS, " ");
  const words = new Set(plain.trim().split(" "));
  if ([...words].some((w) => REFUSE.has(w)) || REFUSE_PHRASES.some((p) => plain.includes(p))) return "no";
  if ([...words].some((w) => AGREE.has(w)) || AGREE_PHRASES.some((p) => plain.includes(p))) return "yes";
  return "no";
}

const ORDINALS: string[][] = [
  ["1", "un", "une", "premier", "premiere"],
  ["2", "deux", "deuxieme", "second", "seconde"],
  ["3", "trois", "troisieme"],
  ["4", "quatre", "quatrieme"],
  ["5", "cinq", "cinquieme"],
  ["6", "six", "sixieme"],
];
const FILLER = new Set(["le", "la", "les", "l", "option", "choix", "numero", "je", "prends", "prend", "veux", "voudrais", "euh", "alors", "celui", "celle", "ci", "du", "de", "d"]);

/** Retrouve quel bouton la personne désigne à voix haute (« le deuxième », « Excel ») ; -1 si aucun. */
export function matchChoice(text: string, choices: string[]): number {
  const plain = normalizeSpeech(text);
  if (!plain || choices.length === 0) return -1;
  const norm = choices.map(normalizeSpeech);

  const exact = norm.findIndex((c) => c === plain);
  if (exact !== -1) return exact;

  const tokens = plain.split(" ");
  const core = tokens.filter((t) => !FILLER.has(t));
  if (core.length === 1) {
    const index = ORDINALS.findIndex((words) => words.includes(core[0]));
    if (index !== -1 && index < choices.length) return index;
  }

  const scores = norm.map((c) => {
    const ctoks = c.split(" ").filter(Boolean);
    return ctoks.length ? ctoks.filter((t) => tokens.includes(t)).length / ctoks.length : 0;
  });
  const best = Math.max(...scores);
  if (best < 0.6) return -1;
  const winners = scores.flatMap((s, i) => (s === best ? [i] : []));
  return winners.length === 1 ? winners[0] : -1;
}

/** Phrases qui terminent la conversation vocale (courtes, pour ne pas confondre avec une vraie demande). */
const END_PHRASES = ["c est bon", "ca suffit", "merci", "stop", "tais toi", "silence", "laisse tomber", "au revoir", "a plus", "termine", "fin de la conversation", "j ai fini", "arrete"];

export function isEndPhrase(text: string): boolean {
  const plain = ` ${normalizeSpeech(text)} `;
  if (plain.trim().split(" ").length > 5) return false;
  return END_PHRASES.some((p) => plain.includes(` ${p} `));
}

/* ---------- Mot d'activation (par transcription) ---------- */

const GREETINGS = new Set(["hey", "hei", "hé", "he", "eh", "ey", "ok", "okay", "salut", "et", "a", "hai", "oh"]);

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const tokenMatches = (heard: string, wanted: string) => heard === wanted || (wanted.length >= 5 && distance(heard, wanted) <= 2) || (wanted.length >= 4 && distance(heard, wanted) <= 1);

/** Variantes que Whisper (français) entend pour le prénom du lanceur. */
const NAME_ALIASES: Record<string, string[]> = { cursor: ["curseur", "kursor", "curser", "cursore", "kurseur"] };

/**
 * Cherche le mot d'activation dans les premiers mots d'une transcription (« Hé Cursor, range mes
 * Téléchargements » → rest = « range mes Téléchargements »). Tolère les variantes d'orthographe de Whisper.
 */
export function matchWake(text: string, phrase: string): { matched: boolean; rest: string } {
  const wanted = normalizeSpeech(phrase).split(" ").filter(Boolean);
  if (!wanted.length) return { matched: false, rest: text };
  const name = wanted[wanted.length - 1];
  const nameVariants = [name, ...(NAME_ALIASES[name] ?? [])];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const norm = words.map((w) => normalizeSpeech(w));
  const lead = wanted.slice(0, -1);

  for (let start = 0; start <= Math.min(2, words.length - 1); start++) {
    let i = start;
    let ok = true;
    for (const w of lead) {
      const heard = norm[i];
      if (heard === undefined || !(tokenMatches(heard, w) || (GREETINGS.has(w) && GREETINGS.has(heard)))) {
        ok = false;
        break;
      }
      i++;
    }
    if (!ok) continue;
    const heardName = norm[i];
    if (heardName !== undefined && nameVariants.some((v) => tokenMatches(heardName, v))) {
      const rest = words.slice(i + 1).join(" ").replace(/^[\s,.:;!?-]+/, "").trim();
      return { matched: true, rest };
    }
  }
  return { matched: false, rest: text };
}

/* ---------- Transcriptions ---------- */

const GHOSTS = ["amara org", "sous titres", "sous titrage", "merci d avoir regarde", "abonnez vous", "a la prochaine video", "n oubliez pas de vous abonner", "thanks for watching", "subtitles by"];

/**
 * Nettoie une transcription : retire les annotations (« [musique] », « (silence) », « [BLANK_AUDIO] »,
 * « ♪ »), et renvoie une chaîne vide pour les phrases que Whisper invente sur du silence ou du bruit.
 */
export function cleanTranscript(text: string): string {
  const cleaned = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ")
    .replace(/[♪♫]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const plain = ` ${normalizeSpeech(cleaned)} `;
  if (GHOSTS.some((g) => plain.includes(` ${g} `) || plain.includes(g))) return "";
  if (normalizeSpeech(cleaned).length < 2) return "";
  return cleaned;
}
