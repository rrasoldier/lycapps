"use client";

import { useLanguage } from "@/components/LanguageProvider";

const appStyles = [
  { icon: "☁️", gradient: "from-sky-500/20 to-blue-600/10" },
  { icon: "📋", gradient: "from-emerald-500/20 to-teal-600/10" },
  { icon: "✨", gradient: "from-violet-500/20 to-purple-600/10" },
];

export default function AppsShowcase() {
  const { t } = useLanguage();

  return (
    <section id="apps" className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-2 text-center text-3xl font-bold">{t.apps.title}</h2>
        <p className="mb-12 text-center text-zinc-400">{t.apps.subtitle}</p>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {t.apps.items.map((app, index) => {
            const style = appStyles[index];

            return (
              <article
                key={app.name}
                className={`group rounded-2xl border border-zinc-800 bg-gradient-to-br ${style.gradient} p-6 transition hover:border-zinc-700 hover:shadow-lg hover:shadow-violet-500/5`}
              >
                <div className="mb-4 text-4xl">{style.icon}</div>
                <h3 className="text-xl font-semibold">{app.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {app.description}
                </p>
                <span className="mt-4 inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 ring-1 ring-amber-500/20">
                  {t.apps.badge}
                </span>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
