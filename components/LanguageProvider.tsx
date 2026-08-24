"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  defaultLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "@/lib/i18n/types";
import {
  getTranslations,
  type Translations,
} from "@/lib/i18n/translations";

type LanguageContextValue = {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;

  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "fr" ? "fr" : defaultLocale;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  useEffect(() => {
    const t = getTranslations(locale);
    document.documentElement.lang = locale;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.title =
      pathname === "/privacy-policy" ? t.privacy.metaTitle : t.meta.title;
  }, [locale, pathname]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const value = useMemo(
    () => ({
      locale,
      t: getTranslations(locale),
      setLocale,
    }),
    [locale, setLocale],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
