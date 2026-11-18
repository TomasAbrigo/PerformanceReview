import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { Panel } from "@/components/insights/parts";
import {
  DRILL_CYCLE_PARAM,
  TrendChart,
} from "@/components/indicators/trend-chart";
import type { DrillBase } from "@/components/drill/drill-link";
import { parseDrill } from "@/modules/insights/drill-spec";
import { isUuid } from "@/lib/uuid";
import { getSettings } from "@/modules/settings";
import { DrillSection } from "../../drill-section";
import { TrendPicker } from "@/components/indicators/trend-picker";
import { parseTrendParams } from "@/components/indicators/url-state";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { indicatorTrendOverview } from "@/modules/analytics/indicators";
import { insightsScope } from "@/modules/insights";
import { ReviewError } from "@/modules/review-core";

async function Trend({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/indicators/trend">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Indicators");
  const kicker = await groupKicker("insights");
  if (insightsScope(actor).kind === "none") return <p>{t("forbidden")}</p>;
  const sp = await searchParams;
  const p = parseTrendParams(sp);
  const settings = await getSettings(db);
  // Drill-down (#117): a point opens the people of that cycle (`dcycle`).
  const base: DrillBase = {
    pathname: "/insights/indicators/trend",
    query: sp,
  };
  const drill = parseDrill(sp.drill);
  const drillCycle =
    typeof sp[DRILL_CYCLE_PARAM] === "string" &&
    isUuid(sp[DRILL_CYCLE_PARAM] as string)
      ? (sp[DRILL_CYCLE_PARAM] as string)
      : null;
  // One subject: a person, else a team, else an area, else the actor's reach.
  const subject = p.person
    ? { personId: p.person }
    : p.manager
      ? { managerId: p.manager }
      : p.department
        ? { department: p.department }
        : {};
  const overview = await indicatorTrendOverview(db, actor, subject).catch(
    forbiddenAsNull,
  );
  if (!overview) return <p>{t("forbidden")}</p>;
  const { trends: found, subjects } = overview;
  const about = found[0].subject;
  const subjectLabel =
    about.kind === "person"
      ? t("trend.subject.person", { name: about.name })
      : about.kind === "manager"
        ? t("trend.subject.team", { name: about.name })
        : about.kind === "department"
          ? t("trend.subject.department", { name: about.department })
          : actor.role === "manager"
            ? t("trend.subject.myTeam")
            : t("trend.subject.all");
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={t("trend.title")}
        description={t("trend.hint", {
          scope:
            actor.role === "manager"
              ? t("trend.subject.myTeam")
              : t("trend.subject.all"),
        })}
        actions={
          <Link className="text-sm underline" href="/insights/indicators">
            {t("trend.back")}
          </Link>
        }
      >
        <TrendPicker params={p} subjects={subjects} />
      </PageHeader>
      {found.map((trend) => (
        <Panel
          key={trend.indicator}
          id={`trend-${trend.indicator}`}
          title={t("trend.of", {
            indicator: t(`indicator.${trend.indicator}`),
            subject: subjectLabel,
          })}
        >
          <TrendChart
            data={trend}
            subject={subjectLabel}
            drillBase={base}
            riskThreshold={settings["alerts.riskThreshold"]}
          />
        </Panel>
      ))}
      {drill && drillCycle ? (
        <Suspense fallback={null}>
          <DrillSection
            actor={actor}
            cycleId={drillCycle}
            drill={drill}
            base={base}
            minGroupSize={settings["aggregation.minGroupSize"]}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

/** forbidden -> null (shown as a message), not_found -> 404. */
function forbiddenAsNull(error: unknown): null {
  if (!(error instanceof ReviewError)) throw error;
  if (error.code === "not_found") notFound();
  return null;
}

export default function TrendPage(
  props: PageProps<"/[locale]/insights/indicators/trend">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <Trend {...props} />
      </Suspense>
    </main>
  );
}
