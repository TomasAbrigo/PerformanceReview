import type { Metadata } from "next";
import { Chakra_Petch, Inter } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActorBar } from "@/components/actor/actor-bar";
import { CycleMemory } from "@/components/cycle-memory";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SideNav } from "@/components/nav/side-nav";
import { routing } from "@/i18n/routing";
import "../globals.css";
import "../visual-data.css";

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
          <Suspense fallback={null}>
            <CycleMemory />
          </Suspense>
          <div className="flex min-h-dvh flex-col lg:flex-row">
            <Suspense
              fallback={
                <div aria-busy="true" className="bg-sidebar lg:w-[220px]" />
              }
            >
              <SideNav />
            </Suspense>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="app-toolbar">
                <span className="hidden text-sm text-muted-foreground xl:block">
                  Performance review
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-4">
                  <Suspense fallback={<div aria-busy="true" className="h-9" />}>
                    <ActorBar />
                  </Suspense>
                  <Suspense fallback={null}>
                    <LocaleSwitcher />
                  </Suspense>
                </div>
              </header>
              <a href="#main-content" className="skip-link">
                {locale === "es" ? "Ir al contenido" : "Skip to content"}
              </a>
              <div id="main-content" className="min-w-0">
                {children}
              </div>
            </div>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
