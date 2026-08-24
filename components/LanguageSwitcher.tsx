"use client";

import { useLanguage } from "@/components/LanguageProvider";
import type { Locale } from "@/lib/i18n/types";

const options: { value: Locale; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "fr", label: "FR" },
];

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div
      className="flex items-center rounded-full border border-zinc-700 bg-zinc-900/80 p-0.5"
      role="group"
      aria-label="Language"
    >
      {options.map(({ value, label }) => {
        const isActive = locale === value;

        return (
          <button
            key={value}
            type="button"
            onClick={() => setLocale(value)}
            aria-pressed={isActive}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              isActive
                ? "bg-violet-600 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
