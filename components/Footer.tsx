"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";

export default function Footer() {
  const { t } = useLanguage();

  return (
    <footer className="border-t border-zinc-800 px-6 py-12">
      <div className="mx-auto max-w-5xl space-y-6 text-sm text-zinc-500">
        <div>
          <h3 className="mb-2 font-medium text-zinc-300">{t.footer.legalTitle}</h3>
          <p>
            <strong className="text-zinc-400">{t.footer.publisher}</strong>{" "}
            Lycapps
            <br />
            {t.footer.publisherDescription}
            <br />
            {t.footer.contact}{" "}
            <a
              href="mailto:contact@anythinglycris.com"
              className="text-violet-400 hover:underline"
            >
              contact@anythinglycris.com
            </a>
          </p>
        </div>
        <div>
          <Link
            href="/privacy-policy"
            className="text-violet-400 hover:underline"
          >
            {t.footer.privacyPolicy}
          </Link>
        </div>
        <p className="border-t border-zinc-800 pt-4">{t.footer.copyright}</p>
      </div>
    </footer>
  );
}
