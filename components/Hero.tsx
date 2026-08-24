"use client";

import { useLanguage } from "@/components/LanguageProvider";

export default function Hero() {
  const { t } = useLanguage();

  return (
    <section className="relative overflow-hidden px-6 py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-zinc-950 to-zinc-950" />
      <div className="relative mx-auto max-w-3xl text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-widest text-violet-400">
          {t.hero.eyebrow}
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          {t.hero.title}{" "}
          <span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
            {t.hero.titleHighlight}
          </span>
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-zinc-400 sm:text-xl">
          {t.hero.description}
        </p>
      </div>
    </section>
  );
}
