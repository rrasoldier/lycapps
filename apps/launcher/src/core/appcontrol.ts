import type { Settings } from "./settings";
import { BORDER_MAX, checkTheme, DEFAULT_THEME, GLASS_MIN, normalizeHex, THEME_PRESETS, type ThemeSettings } from "./theme";
import type { Host } from "./types";

/**
 * Ce que l'agent a le droit de changer dans l'application, à la demande de l'utilisatrice : réglages de voix, thème et
 * quelques comportements. Jamais le code source, les clés, les dossiers autorisés, les raccourcis ni le fournisseur.
 */
export interface AppControl {
  settings(): Settings;
  /** Enregistre et applique tout de suite (fenêtre, voix, mot d'activation). */
  apply(patch: Partial<Settings>): Settings;
  sayVoices(): Promise<string[]>;
  /** Noms des voix Piper installées (sans extension). */
  piperVoices(): string[];
  /** Chemin complet du .onnx d'une voix Piper installée (jamais un chemin fourni par le modèle). */
  piperModelPath(name: string): string;
  /** Phrase décrivant le moteur de voix réellement utilisé (ou pourquoi il se replie sur `say`). */
  voiceStatus(): Promise<string>;
  /** Pourquoi le mot d'activation ne pourrait pas démarrer (null = prêt). */
  wakeProblem(): Promise<string | null>;
}

type Args = Record<string, unknown>;

export const RATE_MIN = 80;
export const RATE_MAX = 400;
export const FOLLOW_UP_MIN = 2;
export const FOLLOW_UP_MAX = 30;

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "oui") return true;
  if (v === "false" || v === "non") return false;
  return undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".").replace("%", "")) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** `0,6` ou `60` (pour cent) -> 0,6. */
function ratio(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return n > 1 ? n / 100 : n;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function describeVoiceSettings(s: Settings): string {
  const engine = s.ttsEngine === "auto" ? "automatique (Piper s'il est installé, sinon voix du Mac)" : s.ttsEngine === "piper" ? "Piper" : "voix du Mac (say)";
  const piper = s.piperModel ? s.piperModel.split("/").pop()?.replace(/\.onnx$/, "") : "détection automatique";
  return `moteur ${engine} ; voix du Mac : ${s.ttsVoice || "automatique (voix française)"} ; voix Piper : ${piper} ; débit ${s.ttsRate} mots/min`;
}

export function describeTheme(s: Settings): string {
  return `accent ${s.themeAccent}, second accent ${s.themeAccent2}, fond ${s.themeBackground}, opacité du fond ${Math.round(s.themeGlass * 100)} %, bordure ${Math.round(s.themeBorder * 100)} %`;
}

export function describeBehavior(s: Settings): string {
  return [
    `bonjour au lancement : ${s.greetOnLaunch ? "oui" : "non"}`,
    `mot d'activation : ${s.wakeWordEnabled ? `oui (« ${s.wakePhrase} »)` : "non"}`,
    `écoute de suite : ${s.followUpSeconds} s`,
    `lecture des réponses écrites : ${s.speakReplies ? "oui" : "non"}`,
  ].join(" ; ");
}

export async function getAppSettings(app: AppControl): Promise<string> {
  const s = app.settings();
  return [
    `Voix : ${describeVoiceSettings(s)}.`,
    `Thème : ${describeTheme(s)}. Préréglages : ${Object.keys(THEME_PRESETS).join(", ")}.`,
    `Comportement : ${describeBehavior(s)}.`,
    `Voix du Mac installées : ${(await app.sayVoices()).join(", ") || "aucune détectée"}. Voix Piper installées : ${app.piperVoices().join(", ") || "aucune"}.`,
  ].join("\n");
}

export async function setVoice(args: Args, app: AppControl): Promise<string> {
  const patch: Partial<Settings> = {};
  const done: string[] = [];

  if (args.engine !== undefined) {
    const e = typeof args.engine === "string" ? norm(args.engine) : "";
    if (e !== "auto" && e !== "piper" && e !== "say") throw new Error("Moteur inconnu : choisissez « auto », « piper » ou « say ».");
    patch.ttsEngine = e;
    done.push(`moteur ${e === "auto" ? "automatique" : e === "piper" ? "Piper" : "voix du Mac (say)"}`);
  }

  if (args.say_voice !== undefined) {
    const wanted = typeof args.say_voice === "string" ? args.say_voice.trim() : "";
    if (!wanted || norm(wanted) === "auto") {
      patch.ttsVoice = "";
      done.push("voix du Mac automatique");
    } else {
      const voices = await app.sayVoices();
      const hit = voices.find((v) => norm(v) === norm(wanted)) ?? voices.find((v) => norm(v).startsWith(norm(wanted)));
      if (!hit) throw new Error(`Voix du Mac « ${wanted} » introuvable. Voix disponibles : ${voices.join(", ") || "aucune détectée (macOS requis)"}.`);
      patch.ttsVoice = hit;
      done.push(`voix du Mac ${hit}`);
    }
  }

  if (args.piper_voice !== undefined) {
    const wanted = typeof args.piper_voice === "string" ? args.piper_voice.trim() : "";
    if (!wanted || norm(wanted) === "auto") {
      patch.piperModel = "";
      done.push("voix Piper automatique");
    } else {
      const voices = app.piperVoices();
      const hit = voices.find((v) => norm(v) === norm(wanted)) ?? voices.find((v) => norm(v).includes(norm(wanted)));
      if (!hit) throw new Error(`Voix Piper « ${wanted} » non installée. Installées : ${voices.join(", ") || "aucune"}. Pour en ajouter : cd apps/launcher && npm run tts:install -- <nom de voix>.`);
      patch.piperModel = app.piperModelPath(hit);
      done.push(`voix Piper ${hit}`);
    }
  }

  if (args.rate !== undefined) {
    const r = num(args.rate);
    if (r === undefined || r < RATE_MIN || r > RATE_MAX) throw new Error(`Débit invalide : entre ${RATE_MIN} et ${RATE_MAX} mots par minute (185 = naturel).`);
    patch.ttsRate = Math.round(r);
    done.push(`débit ${Math.round(r)} mots/min`);
  }

  if (done.length === 0) throw new Error("Rien à changer : précisez engine, say_voice, piper_voice ou rate.");
  const next = app.apply(patch);
  return `Voix modifiée tout de suite : ${done.join(", ")}.\nÉtat réel : ${await app.voiceStatus()}\nRéglages actuels : ${describeVoiceSettings(next)}.`;
}

export function setTheme(args: Args, app: AppControl): string {
  const cur = app.settings();
  const next: ThemeSettings = { themeAccent: cur.themeAccent, themeAccent2: cur.themeAccent2, themeBackground: cur.themeBackground, themeGlass: cur.themeGlass, themeBorder: cur.themeBorder };
  const done: string[] = [];

  if (bool(args.reset) === true) {
    Object.assign(next, DEFAULT_THEME);
    done.push("thème d'origine rétabli");
  }
  if (args.preset !== undefined) {
    const key = typeof args.preset === "string" ? norm(args.preset) : "";
    const p = THEME_PRESETS[key];
    if (!p) throw new Error(`Préréglage inconnu. Disponibles : ${Object.keys(THEME_PRESETS).join(", ")}.`);
    Object.assign(next, p);
    done.push(`préréglage ${key}`);
  }
  for (const [arg, field, label] of [
    ["accent", "themeAccent", "accent"],
    ["accent2", "themeAccent2", "second accent"],
    ["background", "themeBackground", "fond"],
  ] as const) {
    if (args[arg] === undefined) continue;
    const hex = normalizeHex(args[arg]);
    if (!hex) throw new Error(`Couleur « ${String(args[arg])} » invalide pour ${arg} : donnez un code hexadécimal comme #7c5cff (convertissez vous-même le nom de la couleur).`);
    next[field] = hex;
    done.push(`${label} ${hex}`);
  }
  if (args.glass !== undefined) {
    const g = ratio(args.glass);
    if (g === undefined || g < GLASS_MIN || g > 1) throw new Error(`Opacité du fond invalide : entre ${GLASS_MIN} et 1 (ou ${GLASS_MIN * 100} à 100 %). Plus c'est bas, plus la fenêtre est transparente.`);
    next.themeGlass = Math.round(g * 100) / 100;
    done.push(`opacité du fond ${Math.round(g * 100)} %`);
  }
  if (args.border !== undefined) {
    const b = ratio(args.border);
    if (b === undefined || b < 0 || b > BORDER_MAX) throw new Error(`Bordure invalide : entre 0 (aucune) et ${BORDER_MAX} (ou 0 à ${BORDER_MAX * 100} %).`);
    next.themeBorder = Math.round(b * 100) / 100;
    done.push(b === 0 ? "bordure supprimée" : `bordure ${Math.round(b * 100)} %`);
  }

  if (done.length === 0) throw new Error("Rien à changer : précisez preset, accent, accent2, background, glass, border ou reset.");
  const problem = checkTheme(next);
  if (problem) throw new Error(problem);
  const saved = app.apply(next);
  return `Thème modifié tout de suite : ${done.join(", ")}.\nThème actuel : ${describeTheme(saved)}.`;
}

export async function setBehavior(args: Args, app: AppControl, host: Host): Promise<string> {
  const patch: Partial<Settings> = {};
  const done: string[] = [];

  const greet = bool(args.greet_on_launch);
  if (args.greet_on_launch !== undefined) {
    if (greet === undefined) throw new Error("greet_on_launch doit être vrai ou faux.");
    patch.greetOnLaunch = greet;
    done.push(greet ? "bonjour au lancement activé" : "bonjour au lancement désactivé");
  }
  const speak = bool(args.speak_replies);
  if (args.speak_replies !== undefined) {
    if (speak === undefined) throw new Error("speak_replies doit être vrai ou faux.");
    patch.speakReplies = speak;
    done.push(speak ? "lecture des réponses écrites activée" : "lecture des réponses écrites désactivée");
  }
  if (args.wake_phrase !== undefined) {
    const phrase = typeof args.wake_phrase === "string" ? args.wake_phrase.replace(/\s+/g, " ").trim() : "";
    if (phrase.length < 3 || phrase.length > 40) throw new Error("La phrase d'activation doit faire entre 3 et 40 caractères.");
    patch.wakePhrase = phrase;
    done.push(`phrase d'activation « ${phrase} »`);
  }
  if (args.follow_up_seconds !== undefined) {
    const n = num(args.follow_up_seconds);
    if (n === undefined || n < FOLLOW_UP_MIN || n > FOLLOW_UP_MAX) throw new Error(`Durée d'écoute de suite invalide : entre ${FOLLOW_UP_MIN} et ${FOLLOW_UP_MAX} secondes.`);
    patch.followUpSeconds = Math.round(n);
    done.push(`écoute de suite ${Math.round(n)} s`);
  }
  let warning = "";
  if (args.wake_word_enabled !== undefined) {
    const on = bool(args.wake_word_enabled);
    if (on === undefined) throw new Error("wake_word_enabled doit être vrai ou faux.");
    if (on && !app.settings().wakeWordEnabled) {
      // Un micro ouvert en permanence ne s'active jamais sans un accord explicite.
      const ok = await host.confirm({
        title: "Activer le mot d'activation ?",
        detail: "Le micro restera à l'écoute en permanence (transcription 100 % locale, rien n'est envoyé hors du Mac). Désactivable à tout moment.",
        risk: "confirm",
      });
      if (!ok) throw new Error("Refusé par l'utilisatrice : le mot d'activation reste désactivé.");
      const problem = await app.wakeProblem();
      if (problem) warning = `\nAttention : il ne démarrera pas tant que ce n'est pas réglé : ${problem}`;
    }
    patch.wakeWordEnabled = on;
    done.push(on ? "mot d'activation activé" : "mot d'activation désactivé");
  }

  if (done.length === 0) throw new Error("Rien à changer : précisez greet_on_launch, wake_word_enabled, wake_phrase, follow_up_seconds ou speak_replies.");
  const next = app.apply(patch);
  return `Comportement modifié tout de suite : ${done.join(", ")}.${warning}\nRéglages actuels : ${describeBehavior(next)}.`;
}
