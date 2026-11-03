/** Message d'accueil affiché à l'écran : le nom reste « Cris ». */
export const GREETING_TEXT = "Bonjour, c'est Cris, à ton service.";

/**
 * Écrit un texte pour le moteur de voix : « Cris » doit sonner « criss » (/kʁis/, comme le prénom anglais) et non
 * « cri » à la française. Piper (comme `say`) lit « Criss » avec le s final. Seuls le nom propre, avec sa majuscule,
 * et « AlphaCris » sont touchés : le mot « cris » (des cris) n'est pas modifié.
 */
export function pronounceForSpeech(text: string): string {
  return text.replace(/\bAlpha\s?Cris(?![\p{L}\p{N}])/giu, "Alpha Criss").replace(/(?<![\p{L}\p{N}])Cris(?![\p{L}\p{N}])/gu, "Criss");
}
