"use client";

import Link from "next/link";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/components/LanguageProvider";

export default function PrivacyPolicyContent() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" className="text-sm text-violet-400 hover:underline">
            {t.privacy.back}
          </Link>
          <LanguageSwitcher />
        </div>

        <div className="prose prose-invert">
          <h1 className="text-3xl font-bold">{t.privacy.title}</h1>
          <p className="mt-4 leading-relaxed text-zinc-400">{t.privacy.updated}</p>

          <section className="mt-8 space-y-4 leading-relaxed text-zinc-300">
            <p>{t.privacy.intro}</p>
            <h2 className="text-xl font-semibold text-white">
              {t.privacy.dataTitle}
            </h2>
            <p>{t.privacy.dataBody}</p>
            <h2 className="text-xl font-semibold text-white">
              {t.privacy.contactTitle}
            </h2>
            <p>
              {t.privacy.contactBody}{" "}
              <a
                href="mailto:contact@anythinglycris.com"
                className="text-violet-400 hover:underline"
              >
                contact@anythinglycris.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
