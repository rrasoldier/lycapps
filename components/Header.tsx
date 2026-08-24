"use client";

import Image from "next/image";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/components/LanguageProvider";

export default function Header() {
  const { t } = useLanguage();

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <a href="#" className="flex items-center gap-3">
          <Image
            src="/logo.svg"
            alt="Lycapps"
            width={40}
            height={40}
            className="h-10 w-10"
          />
          <span className="text-xl font-semibold tracking-tight">Lycapps</span>
        </a>
        <div className="flex items-center gap-4">
          <nav className="hidden gap-6 text-sm text-zinc-400 sm:flex">
            <a href="#apps" className="transition-colors hover:text-white">
              {t.header.apps}
            </a>
            <a href="#contact" className="transition-colors hover:text-white">
              {t.header.contact}
            </a>
          </nav>
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
