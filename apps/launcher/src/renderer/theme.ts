export interface ThemeValues {
  themeAccent: string;
  themeAccent2: string;
  themeBackground: string;
  themeGlass: number;
  themeBorder: number;
}

export const DEFAULT_THEME_VALUES: ThemeValues = {
  themeAccent: "#7c5cff",
  themeAccent2: "#2fd4ff",
  themeBackground: "#0c0d14",
  themeGlass: 0.72,
  themeBorder: 0.1,
};

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const HEX = /^#([0-9a-f]{6})$/i;

/** `#rrggbb` -> teinte (0-360), saturation et luminosité (0-100). Valeur invalide : null. */
export function hexToHsl(hex: string): Hsl | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Variables CSS correspondant au thème (valeurs bornées : un réglage corrompu ne rend jamais l'interface illisible). */
export function themeVars(t: ThemeValues): Record<string, string> {
  const hex = (v: string, fallback: string) => (HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback);
  return {
    "--accent": hex(t.themeAccent, "#7c5cff"),
    "--accent2": hex(t.themeAccent2, "#2fd4ff"),
    "--bg": hex(t.themeBackground, "#0c0d14"),
    "--glass": `${Math.round(clamp(Number(t.themeGlass) || 0.72, 0.25, 1) * 100)}%`,
    "--border": String(Math.round(clamp(Number.isFinite(Number(t.themeBorder)) ? Number(t.themeBorder) : 0.1, 0, 0.6) * 100) / 100),
  };
}

export function applyThemeVars(t: ThemeValues, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
}

/** Teintes et saturation utilisées par l'orbe, déduites des deux couleurs d'accent. */
export function orbColors(t: ThemeValues): { hueA: number; hueB: number; sat: number } {
  const a = hexToHsl(themeVars(t)["--accent"]) ?? { h: 255, s: 100, l: 68 };
  const b = hexToHsl(themeVars(t)["--accent2"]) ?? { h: 190, s: 100, l: 59 };
  return { hueA: a.h, hueB: b.h, sat: clamp((a.s + b.s) / 2 / 90, 0.1, 1) };
}
