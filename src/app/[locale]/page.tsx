import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NavIcon } from "@/components/nav/nav-icon";
import { navGroups } from "@/components/nav/nav-items";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { actorIsHr } from "@/modules/actor/server";

/**
 * The sections as cards, grouped by purpose. Data and Settings are People-only
 * screens, so the other roles do not see them (the screens themselves are
 * gated too).
 */
async function HomeNav() {
  const t = await getTranslations();
  const hr = await actorIsHr();
  const groups = navGroups(t, hr);

  return (
    <nav aria-label={t("Home.navigation")} className="flex flex-col gap-10">
      {groups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`home-group-${group.key}`}
          className="flex flex-col gap-4"
        >
          <h2 id={`home-group-${group.key}`} className="text-2xl">
            {group.title}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {group.items.map((item) => (
              <li
                key={item.key}
                className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-brand-600 has-[a:focus-visible]:border-brand-600 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/40"
              >
                <span className="flex size-10 items-center justify-center rounded-[10px] bg-brand-fog text-brand-700">
                  <NavIcon icon={item.key} className="size-5" />
                </span>
                <Link
                  href={item.href}
                  className="font-medium text-foreground outline-none group-hover:text-brand-700 after:absolute after:inset-0 after:rounded-xl"
                >
                  {item.label}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const tApp = await getTranslations("App");
  const tHome = await getTranslations("Home");
  const tBrand = await getTranslations("Brand");

  return (
    <main className="flex flex-1 flex-col gap-10 p-6 lg:p-10">
      <section className="brand-hero overflow-hidden rounded-2xl px-8 py-12 lg:px-14 lg:py-16">
        <p className="kicker text-brand-200">{tBrand("company")}</p>
        <h1 className="mt-4 text-5xl lg:text-6xl">{tApp("title")}</h1>
        <p className="mt-4 font-heading text-2xl text-white/90">
          {tHome("heading")}
        </p>
        <p className="mt-3 max-w-xl text-base text-white/75">
          {tHome("welcome")}
        </p>
      </section>
      <Suspense fallback={<div aria-busy="true" className="h-64" />}>
        <HomeNav />
      </Suspense>
    </main>
  );
}
