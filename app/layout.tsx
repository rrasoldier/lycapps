import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { LanguageProvider } from "@/components/LanguageProvider";
import { translations } from "@/lib/i18n/translations";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: translations.en.meta.title,
  description: translations.en.meta.description,
  metadataBase: new URL("https://lycapps.com"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
