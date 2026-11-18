import { IconTile, PageSkeleton } from "@/components/experience";
import { ArrowRight, Sprout } from "lucide-react";
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
import { insightsScope } from "@/modules/insights/authz";
import { listCycles, personName } from "@/modules/review-core";
import { localizeCycles } from "@/modules/review-core/cycle-name";

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
 * The head of the home, as the canvas draws it: a greeting by role, the
 * cycle in focus with one call to action, the three main entries (Goals,
 * Assessments, the Analysis) the actor may open and, for People, a reminder
 * to check the data before analysing.
 */
async function HomeHead({ locale }: { locale: string }) {
  await connection();
  const [t, actor] = await Promise.all([getTranslations("Home"), getActor()]);
  const [name, cycles] = await Promise.all([
    actor.personId ? personName(db, actor.personId) : null,
    listCycles(db),
  ]);
  const cycle = localizeCycles(cycles, locale)[0];
  const analysis = insightsScope(actor).kind !== "none";
  const greeting =
    actor.role === "hr"
      ? t("greeting.hr")
      : actor.role === "direction"
        ? t("greeting.direction")
        : name
          ? t("greeting.person", { name })
          : t("greeting.noPerson");
  const cycleHref = cycle
    ? analysis
      ? `/insights/executive?cycle=${cycle.id}`
      : `/assessments?cycle=${cycle.id}`
    : "/assessments";
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl lg:text-4xl">{greeting}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <section className="home-focus" aria-label={t("focus.headline")}>
        <div className="flex items-start gap-5">
          <IconTile>
            <Sprout className="size-5" />
          </IconTile>
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="text-2xl text-white lg:text-3xl">
              {t("focus.headline")}
            </h2>
            <p className="text-sm text-brand-200">
              {cycle
                ? t("focus.line", { cycle: cycle.name })
                : t("focus.noCycle")}
            </p>
          </div>
        </div>
        {cycle ? (
          <Link href={cycleHref} className="button-outline self-start">
            {t("focus.cta")}
            <ArrowRight className="ml-2 size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </section>
    </div>
  );
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const tHome = await getTranslations("Home");

  return (
    <main className="flex flex-1 flex-col gap-10 p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <HomeHead locale={locale} />
      </Suspense>
      <Suspense fallback={<PageSkeleton />}>
        <HomeSignal locale={locale} />
      </Suspense>
      <section aria-labelledby="home-all" className="flex flex-col gap-4">
        <h2 id="home-all" className="text-2xl">
          {tHome("all")}
        </h2>
        <Suspense fallback={null}>
          <HomeNav />
        </Suspense>
      </section>
    </main>
  );
}
