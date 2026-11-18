import type { Metadata } from "next";
import { Chakra_Petch, Inter } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActorBar } from "@/components/actor/actor-bar";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SideNav } from "@/components/nav/side-nav";
import { routing } from "@/i18n/routing";
import "../globals.css";

// Brand type: Chakra Petch Light for headings, Inter for body and UI.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const chakraPetch = Chakra_Petch({
  variable: "--font-heading",
  weight: ["300", "400"],
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "App" });

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${chakraPetch.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <NextIntlClientProvider>
          <div className="flex min-h-dvh flex-col lg:flex-row">
            <Suspense
              fallback={<div aria-busy="true" className="bg-sidebar lg:w-64" />}
            >
              <SideNav />
            </Suspense>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/90 px-6 py-2.5 backdrop-blur lg:px-10">
                <Suspense fallback={<div aria-busy="true" className="h-9" />}>
                  <ActorBar />
                </Suspense>
                <LocaleSwitcher />
              </header>
              {children}
            </div>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
