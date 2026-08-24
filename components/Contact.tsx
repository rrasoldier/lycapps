"use client";

import { useLanguage } from "@/components/LanguageProvider";

export default function Contact() {
  const { t } = useLanguage();

  return (
    <section id="contact" className="px-6 py-20">
      <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center sm:p-12">
        <h2 className="text-2xl font-bold sm:text-3xl">{t.contact.title}</h2>
        <p className="mt-4 text-zinc-400">{t.contact.description}</p>
        <a
          href="mailto:contact@anythinglycris.com"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-violet-500"
        >
          contact@anythinglycris.com
        </a>
      </div>
    </section>
  );
}
