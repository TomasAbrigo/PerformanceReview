import { PageSkeleton } from "@/components/experience";
import { HomeSignal } from "./home-signal";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NavIcon } from "@/components/nav/nav-icon";
import { navGroups } from "@/components/nav/nav-items";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { connection } from "next/server";
import { db } from "@/db/client";
import { getActor } from "@/modules/actor/server";
import { personName } from "@/modules/review-core";

/**
 * Every section the actor may open, as a compact directory at the foot of the
 * home (the sidebar is the main way around; this is the map, one line per
 * section, its description as the link's title).
 */
async function HomeNav() {
  const t = await getTranslations();
  const actor = await getActor();
  const groups = navGroups(t, actor);
  return (
    <nav
      aria-label={t("Home.navigation")}
      className="grid gap-6 rounded-xl border border-border bg-card p-6 sm:grid-cols-2 xl:grid-cols-4"
    >
      {groups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`home-group-${group.key}`}
          className="flex flex-col gap-2"
        >
          <h2 id={`home-group-${group.key}`} className="kicker">
            {/* A primary group is its one entry ("Mis objetivos" for an employee). */}
            {group.primary && group.items.length === 1
              ? group.items[0].label
              : group.title}
          </h2>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  title={item.description}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-brand-fog hover:text-brand-700"
                >
                  <NavIcon icon={item.key} className="size-4 text-brand-700" />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/**
 * The head of the home: a greeting by role. The cycle in focus, its
 * progress and what needs attention come right under it (`HomeSignal`).
 */
async function HomeHead() {
  await connection();
  const [t, actor] = await Promise.all([getTranslations("Home"), getActor()]);
  const name = actor.personId ? await personName(db, actor.personId) : null;
  const greeting =
    actor.role === "hr"
      ? t("greeting.hr")
      : actor.role === "direction"
        ? t("greeting.direction")
        : name
          ? t("greeting.person", { name })
          : t("greeting.noPerson");
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl lg:text-4xl">{greeting}</h1>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
    </div>
  );
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const tHome = await getTranslations("Home");

  return (
    <main className="flex flex-1 flex-col gap-8 p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <HomeHead />
      </Suspense>
      <Suspense fallback={<PageSkeleton />}>
        <HomeSignal locale={locale} />
      </Suspense>
      <section aria-labelledby="home-all" className="flex flex-col gap-4">
        <h2 id="home-all" className="kicker text-muted-foreground">
          {tHome("all")}
        </h2>
        <Suspense fallback={null}>
          <HomeNav />
        </Suspense>
      </section>
    </main>
  );
}
