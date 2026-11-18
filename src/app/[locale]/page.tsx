import { IconTile, PageSkeleton } from "@/components/experience";
import {
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  ClipboardCheck,
  Database,
  Sprout,
  Target,
} from "lucide-react";
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

/** The stretched link of a card: the whole card is its target. */
const CARD =
  "group relative flex flex-col gap-3 rounded-xl border border-border bg-card transition-colors hover:border-brand-600 has-[a:focus-visible]:border-brand-600 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/40";
const STRETCHED =
  "font-medium text-foreground outline-none group-hover:text-brand-700 after:absolute after:inset-0 after:rounded-xl";

/**
 * The sections as cards: Goals and Assessments first, as two big entries
 * (what people come for), then the Analysis, then Data and Settings (People
 * only). Each role gets the groups it may open (see `navGroups`); the screens
 * themselves are gated too.
 */
async function HomeNav() {
  const t = await getTranslations();
  const actor = await getActor();
  const groups = navGroups(t, actor);
  const primary = groups.filter((g) => g.primary);
  const sections = groups.filter((g) => !g.primary);

  return (
    <nav aria-label={t("Home.navigation")} className="flex flex-col gap-10">
      {primary.length > 0 ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {primary.map((group) =>
            group.items.map((item) => (
              <li key={item.key} className={`${CARD} p-7`}>
                <span className="flex size-12 items-center justify-center rounded-xl bg-brand-fog text-brand-700">
                  <NavIcon icon={item.key} className="size-6" />
                </span>
                <h2 className="text-3xl">
                  <Link href={item.href} className={STRETCHED}>
                    {item.label}
                  </Link>
                </h2>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </li>
            )),
          )}
        </ul>
      ) : null}
      {sections.map((group) => (
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
              <li key={item.key} className={`${CARD} p-5`}>
                <span className="flex size-10 items-center justify-center rounded-[10px] bg-brand-fog text-brand-700">
                  <NavIcon icon={item.key} className="size-5" />
                </span>
                <Link href={item.href} className={STRETCHED}>
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
  const groups = navGroups(await getTranslations(), actor);
  const has = (key: string) => groups.some((g) => g.key === key);
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
  const entries = [
    has("goals")
      ? {
          key: "goals",
          href: "/goals",
          title: t("groups.goals"),
          text: t("access.goals"),
          icon: <Target className="size-5" />,
        }
      : null,
    has("assessments")
      ? {
          key: "assessments",
          href: "/assessments",
          title: t("groups.assessments"),
          text: t("access.assessments"),
          icon: <ClipboardCheck className="size-5" />,
        }
      : null,
    analysis
      ? {
          key: "insights",
          href: "/insights/executive",
          title: t("groups.insights"),
          text: t("access.insights"),
          icon: <ChartNoAxesCombined className="size-5" />,
        }
      : null,
  ].filter((e) => e !== null);
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
      {entries.length > 0 ? (
        <ul aria-label={t("access.title")} className="home-access">
          {entries.map((e) => (
            <li key={e.key} className={`${CARD} p-6`}>
              <IconTile>{e.icon}</IconTile>
              <h2 className="text-2xl">
                <Link href={e.href} className={STRETCHED}>
                  {e.title}
                </Link>
              </h2>
              <p className="text-sm text-muted-foreground">{e.text}</p>
              <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm text-foreground">
                {t("access.explore")}
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {actor.role === "hr" ? (
        <aside className="home-before" aria-label={t("before.title")}>
          <IconTile>
            <Database className="size-5" />
          </IconTile>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium">{t("before.title")}</p>
            <p className="text-sm text-muted-foreground">{t("before.text")}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Link href="/imports/runs" className="button-outline">
              {t("groups.data")}
            </Link>
            <Link href="/data-quality" className="button-outline">
              {t("descriptions.dataQuality").split(" ")[0] === "Casos"
                ? "Calidad de datos"
                : "Data quality"}
            </Link>
          </div>
        </aside>
      ) : null}
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
      <section aria-labelledby="home-all" className="flex flex-col gap-6">
        <h2 id="home-all" className="text-2xl">
          {tHome("all")}
        </h2>
        <Suspense fallback={<PageSkeleton />}>
          <HomeNav />
        </Suspense>
      </section>
    </main>
  );
}
