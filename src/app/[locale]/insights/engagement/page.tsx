import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { EngagementView } from "@/components/engagement/engagement-view";
import { EngagementFiltersForm } from "@/components/engagement/filters";
import {
  monthStart,
  parseEngagementParams,
} from "@/components/engagement/params";
import { orgFiltersOf } from "@/components/org/params";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  engagementEvolution,
  engagementFilterOptions,
} from "@/modules/analytics/engagement";
import { insightsScope } from "@/modules/insights/authz";
import { getSettings } from "@/modules/settings";
import { kpiThresholds } from "@/modules/insights/tone";
import { parseDrill } from "@/modules/insights/drill-spec";
import type { DrillBase } from "@/components/drill/drill-link";
import { DrillSection } from "../drill-section";

async function Engagement({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/engagement">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Engagement");
  const kicker = await groupKicker("insights");
  const settings = await getSettings(db);
  const minGroupSize = settings["aggregation.minGroupSize"];
  // The scope decides what is shown: People everything, a manager their
  // direct reports, direction aggregates; anybody else nothing.
  const scope = insightsScope(actor, minGroupSize);
  if (scope.kind === "none") {
    return (
      <section className="flex flex-col gap-2" data-testid="no-access">
        <h1>{t("title")}</h1>
        <p>{t("forbidden")}</p>
      </section>
    );
  }
  const sp = await searchParams;
  const p = parseEngagementParams(sp);
  // Drill-down (#117): a month or a segment opens its people.
  const masked = scope.kind === "aggregatesOnly";
  // Direction never carries the filters that name a person (a DM, a Santex Lead).
  const base: DrillBase = {
    pathname: "/insights/engagement",
    query: Object.fromEntries(
      Object.entries(sp).filter(
        ([k]) => !masked || (k !== "dm" && k !== "santexLead"),
      ),
    ),
  };
  const drill = parseDrill(sp.drill);
  const [data, options] = await Promise.all([
    engagementEvolution(db, actor, {
      from: monthStart(p.from),
      to: monthStart(p.to),
      department: p.department,
      ...orgFiltersOf(p),
      minGroupSize,
    }),
    engagementFilterOptions(db, actor),
  ]);
  const hint =
    scope.kind === "aggregatesOnly"
      ? t("hint.aggregates", { min: scope.minGroupSize })
      : scope.kind === "directReports"
        ? t("hint.reports")
        : t("hint.all");
  return (
    <div className="flex flex-col gap-8">
      <PageHeader kicker={kicker} title={t("title")} description={hint}>
        <EngagementFiltersForm
          params={p}
          options={options}
          range={{ from: data.from, to: data.to }}
        />
      </PageHeader>
      {options.lastMonth === null ? (
        <p data-testid="engagement-empty">{t("noData")}</p>
      ) : (
        <EngagementView
          data={data}
          context={{ base, targets: kpiThresholds(settings) }}
        />
      )}
      {drill?.kind === "engagement" ? (
        <Suspense fallback={null}>
          <DrillSection
            actor={actor}
            cycleId=""
            drill={drill}
            base={base}
            minGroupSize={minGroupSize}
            filters={
              scope.kind === "aggregatesOnly" ? {} : { ...orgFiltersOf(p) }
            }
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default function EngagementPage(
  props: PageProps<"/[locale]/insights/engagement">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <Engagement {...props} />
      </Suspense>
    </main>
  );
}
