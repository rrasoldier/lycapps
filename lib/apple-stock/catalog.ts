export type CountryCode = "fr" | "be-fr" | "ch-fr" | "de" | "uk" | "us";

export type ColorId = "night-sky" | "star-white";

export type Storage = "256" | "512" | "1024" | "2048";

export interface Country {
  code: CountryCode;
  label: string;
  flag: string;
  /** Path prefix on apple.com, e.g. "fr/" ("" for the US store). */
  path: string;
  currency: string;
  locale: string;
  locationPlaceholder: string;
  defaultLocation: string;
}

export interface Variant {
  partNumber: string;
  color: ColorId;
  storage: Storage;
  price: number;
}

export interface Model {
  id: string;
  name: string;
  /** Reference models are already in stock: useful to verify notifications. */
  reference?: boolean;
  colors: { id: ColorId; label: string; hex: string }[];
  variantsByCountry: Partial<Record<CountryCode, Variant[]>>;
}

export const COUNTRIES: Country[] = [
  { code: "fr", label: "France", flag: "🇫🇷", path: "fr/", currency: "EUR", locale: "fr-FR", locationPlaceholder: "75001 ou Lyon", defaultLocation: "75001" },
  { code: "be-fr", label: "Belgique", flag: "🇧🇪", path: "be-fr/", currency: "EUR", locale: "fr-BE", locationPlaceholder: "1000 ou Bruxelles", defaultLocation: "1000" },
  { code: "ch-fr", label: "Suisse", flag: "🇨🇭", path: "ch-fr/", currency: "CHF", locale: "fr-CH", locationPlaceholder: "1204 ou Genève", defaultLocation: "1204" },
  { code: "de", label: "Allemagne", flag: "🇩🇪", path: "de/", currency: "EUR", locale: "de-DE", locationPlaceholder: "10115 ou Berlin", defaultLocation: "10115" },
  { code: "uk", label: "Royaume-Uni", flag: "🇬🇧", path: "uk/", currency: "GBP", locale: "en-GB", locationPlaceholder: "W1B 2EL ou London", defaultLocation: "W1B 2EL" },
  { code: "us", label: "États-Unis", flag: "🇺🇸", path: "", currency: "USD", locale: "en-US", locationPlaceholder: "10001 ou New York", defaultLocation: "10001" },
];

export const STORAGE_LABELS: Record<Storage, string> = {
  "256": "256 Go",
  "512": "512 Go",
  "1024": "1 To",
  "2048": "2 To",
};

/**
 * Part numbers and prices scraped from apple.com/<pays>/shop/buy-iphone/iphone-duo
 * (embedded "products" JSON) on 2026-10-16. Europe shares the MK2x4 base with a
 * regional suffix; the US store uses its own MK1x4 base.
 */
function europe(suffix: string, prices: Record<Storage, number>): Variant[] {
  const base: [string, ColorId, Storage][] = [
    ["MK2D4", "star-white", "256"],
    ["MK2E4", "night-sky", "256"],
    ["MK2F4", "star-white", "512"],
    ["MK2G4", "night-sky", "512"],
    ["MK2H4", "star-white", "1024"],
    ["MK2J4", "night-sky", "1024"],
    ["MK2K4", "star-white", "2048"],
    ["MK2L4", "night-sky", "2048"],
  ];
  return base.map(([sku, color, storage]) => ({
    partNumber: `${sku}${suffix}/A`,
    color,
    storage,
    price: prices[storage],
  }));
}

const EUR_FR = { "256": 2339, "512": 2589, "1024": 3089, "2048": 3839 } as const;
const EUR_DE = { "256": 2299, "512": 2549, "1024": 3049, "2048": 3799 } as const;
const CHF = { "256": 1999, "512": 2199, "1024": 2599, "2048": 3199 } as const;
const GBP = { "256": 1999, "512": 2199, "1024": 2599, "2048": 3199 } as const;

export const MODELS: Model[] = [
  {
    id: "iphone-duo",
    name: "iPhone Duo",
    colors: [
      { id: "night-sky", label: "Ciel nocturne", hex: "#1f2433" },
      { id: "star-white", label: "Blanc stellaire", hex: "#ecebe6" },
    ],
    variantsByCountry: {
      fr: europe("F", EUR_FR),
      "be-fr": europe("ZD", EUR_FR),
      "ch-fr": europe("QL", CHF),
      de: europe("ZD", EUR_DE),
      uk: europe("QN", GBP),
      us: [
        { partNumber: "MK1E4LL/A", color: "star-white", storage: "256", price: 1999 },
        { partNumber: "MK1F4LL/A", color: "night-sky", storage: "256", price: 1999 },
        { partNumber: "MK1G4LL/A", color: "star-white", storage: "512", price: 2199 },
        { partNumber: "MK1H4LL/A", color: "night-sky", storage: "512", price: 2199 },
        { partNumber: "MK1J4LL/A", color: "star-white", storage: "1024", price: 2599 },
        { partNumber: "MK1L4LL/A", color: "night-sky", storage: "1024", price: 2599 },
        { partNumber: "MK1Q4LL/A", color: "star-white", storage: "2048", price: 3199 },
        { partNumber: "MK1R4LL/A", color: "night-sky", storage: "2048", price: 3199 },
      ],
    },
  },
  {
    id: "iphone-17",
    name: "iPhone 17 (témoin)",
    reference: true,
    colors: [{ id: "night-sky", label: "Noir", hex: "#1c1c1e" }],
    variantsByCountry: {
      fr: [{ partNumber: "MG6J4F/A", color: "night-sky", storage: "256", price: 1119 }],
    },
  },
];

export const PART_NUMBER_RE = /^[A-Z0-9]{4,6}[A-Z]{1,2}\/A$/;

export function getCountry(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function findVariant(partNumber: string) {
  for (const model of MODELS) {
    for (const variants of Object.values(model.variantsByCountry)) {
      const variant = variants?.find((v) => v.partNumber === partNumber);
      if (variant) return { model, variant };
    }
  }
  return undefined;
}
