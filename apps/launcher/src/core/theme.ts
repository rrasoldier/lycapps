/** Thème de l'application : couleurs, transparence « glass » et bordure. Tout est validé ici avant d'être enregistré. */

export interface ThemeSettings {
  themeAccent: string;
  themeAccent2: string;
  themeBackground: string;
  /** Opacité du fond de la fenêtre (1 = opaque, 0,25 = très transparent). */
  themeGlass: number;
  /** Opacité de la bordure (0 = aucune). */
  themeBorder: number;
}

export const DEFAULT_THEME: ThemeSettings = {
  themeAccent: "#7c5cff",
  themeAccent2: "#2fd4ff",
  themeBackground: "#0c0d14",
  themeGlass: 0.72,
  themeBorder: 0.1,
};

export const GLASS_MIN = 0.25;
export const BORDER_MAX = 0.6;

export const THEME_PRESETS: Record<string, Pick<ThemeSettings, "themeAccent" | "themeAccent2" | "themeBackground">> = {
  defaut: { themeAccent: "#7c5cff", themeAccent2: "#2fd4ff", themeBackground: "#0c0d14" },
  ocean: { themeAccent: "#2f80ff", themeAccent2: "#2fe0d0", themeBackground: "#08121c" },
  foret: { themeAccent: "#2fbf71", themeAccent2: "#b4e33d", themeBackground: "#0a140f" },
  couchant: { themeAccent: "#ff7a45", themeAccent2: "#ffc23d", themeBackground: "#170d0b" },
  rose: { themeAccent: "#ff5fa2", themeAccent2: "#b36bff", themeBackground: "#150b14" },
  graphite: { themeAccent: "#9aa3b5", themeAccent2: "#e4e8f0", themeBackground: "#101114" },
};

/** `#abc` ou `#aabbcc` (casse libre, `#` facultatif) -> `#aabbcc`, sinon null. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

/** Luminance relative (0 = noir, 1 = blanc), formule WCAG. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Le texte de l'application est clair : le fond doit rester sombre pour que tout reste lisible. */
export const MAX_BACKGROUND_LUMINANCE = 0.12;
/** Une couleur d'accent trop sombre rendrait boutons et orbe invisibles. */
export const MIN_ACCENT_LUMINANCE = 0.08;

export function checkTheme(t: ThemeSettings): string | null {
  if (luminance(t.themeBackground) > MAX_BACKGROUND_LUMINANCE) return "Fond trop clair : le texte de l'application est blanc, il deviendrait illisible. Choisissez un fond sombre.";
  if (luminance(t.themeAccent) < MIN_ACCENT_LUMINANCE || luminance(t.themeAccent2) < MIN_ACCENT_LUMINANCE) return "Couleur d'accent trop sombre : l'orbe et les boutons deviendraient invisibles.";
  return null;
}
