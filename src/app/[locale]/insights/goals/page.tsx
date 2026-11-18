import { EmptyState } from "@/components/experience";
import { PageSkeleton } from "@/components/experience";
import { localizeCycles } from "@/modules/review-core/cycle-name";
import { rememberedCycle } from "@/modules/review-core/remembered-cycle";
import { pickCycle } from "@/modules/review-core/current-cycle";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { Toggle } from "@/components/insights/controls";
import { Panel } from "@/components/insights/parts";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { BucketsChart } from "@/components/goals-insights/buckets-chart";
import { GoalsFilters } from "@/components/goals-insights/filters";
import { GoalsScatter } from "@/components/goals-insights/goals-scatter";
import { KpisTable } from "@/components/goals-insights/kpis-table";
import { OutliersView } from "@/components/goals-insights/outliers";
import { orgFiltersOf } from "@/components/org/params";
import {
  matchesPerson,
  PeopleSearch,
  PeopleTable,
} from "@/components/goals-insights/people-table";
import {
  hrefWith,
  parseGoalsInsightsParams,
} from "@/components/goals-insights/url-state";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { isUuid } from "@/lib/uuid";
import { getActor } from "@/modules/actor/server";
import { hierarchies } from "@/modules/analytics/dashboards/types";
import {
  type GoalGroupBy,
  goalGroupBys,
  goalInsights,
  indicators,
} from "@/modules/analytics/goals-insights";
import { insightsScope } from "@/modules/insights/authz";
import { withoutPersonFilters } from "@/modules/org-attributes/kinds";
import { listCycles } from "@/modules/review-core";

async function GoalsInsights({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/goals">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("GoalsInsights");
  const kicker = await groupKicker("insights");
  const scope = insightsScope(actor);
  if (scope.kind === "none") return <p role="alert">{t("forbidden")}</p>;
  const aggregates = scope.kind === "aggregatesOnly";
  // Direction does not filter by the people who lead a team (a DM, a Santex Lead).
  const sp = await searchParams;
  const p = withoutPersonFilters(parseGoalsInsightsParams(sp), aggregates);
  const who = typeof sp.who === "string" ? sp.who : undefined;
  // Direction never sees a person: its grouping is the area or the manager.
  const groupBy: GoalGroupBy =
    aggregates && p.groupBy === "person" ? "department" : p.groupBy;
  const cycles = localizeCycles(await listCycles(db), locale)
    .filter((c) => c.status !== "draft")
    .sort(
      (a, b) =>
        b.periodEnd.localeCompare(a.periodEnd) || a.name.localeCompare(b.name),
    );
  if (!cycles.length) return <EmptyState>{t("noCycles")}</EmptyState>;
  const cycle =
    pickCycle(
      cycles.filter((c) => isUuid(c.id)),
      p.cycle,
      await rememberedCycle(),
    ) ?? cycles[0];
  const shown = { ...p, groupBy, cycle: cycle.id };
  // One load of the participants feeds the KPIs, the buckets, the outliers
  // and the filter options.
  const {
    kpis,
    vsIndicators: vs,
    outliers,
    options,
  } = await goalInsights(db, actor, {
    cycleId: cycle.id,
    hierarchy: p.hierarchy,
    groupBy,
    filters: {
      department: p.department,
      managerId: p.manager,
      ...orgFiltersOf(p),
    },
  });
  const here = "/insights/goals";
  // A person's drill: their assessment of the cycle, goals of the period beside.
  const assessmentOf = (participantId: string) =>
    `/assessments/${cycle.id}/${participantId}`;
  const people = vs.rows.filter((r) => matchesPerson(r, who));
  // CSV exports go through the API (People's visibility): offered to People only.
  const csv = (file: string, extra: Record<string, string> = {}) =>
    actor.role === "hr" ? (
      <ExportCsvLink
        file={file}
        params={{
          cycle: cycle.id,
          hierarchy: p.hierarchy,
          department: p.department,
          manager: p.manager,
          ...orgFiltersOf(p),
          ...extra,
        }}
      />
    ) : undefined;
  const scopeNote =
    scope.kind === "directReports"
      ? t("scope.directReports")
      : aggregates
        ? t("scope.aggregatesOnly", { min: scope.minGroupSize })
        : null;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={t("heading", { cycle: cycle.name })}
        description={scopeNote ?? undefined}
      >
        <GoalsFilters
          params={shown}
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          options={options}
        />
        <div className="flex flex-wrap gap-4">
          <Toggle
            label={t("hierarchy.label")}
            options={hierarchies}
            current={p.hierarchy}
            hrefFor={(h) => hrefWith(here, shown, { hierarchy: h })}
            text={(h) => t(`hierarchy.${h}`)}
          />
        </div>
      </PageHeader>
      <Panel
        id="goal-kpis"
        title={t("kpis.title")}
        hint={t("kpis.hint")}
        actions={csv("insights-goal-kpis", { groupBy })}
      >
        <Toggle
          label={t("groupBy.label")}
          options={goalGroupBys.filter((g) => !aggregates || g !== "person")}
          current={groupBy}
          hrefFor={(g) => hrefWith(here, shown, { groupBy: g })}
          text={(g) => t(`groupBy.${g}`)}
        />
        <KpisTable kpis={kpis} />
      </Panel>
      {vs.rows.length > 0 ? (
        <Panel
          id="goals-scatter"
          title={t("scatter.title", {
            indicator: t(`indicator.${p.indicator}`).toLowerCase(),
          })}
          hint={t("scatter.hint")}
        >
          <Toggle
            label={t("indicator.label")}
            options={indicators}
            current={p.indicator}
            hrefFor={(i) => hrefWith(here, shown, { indicator: i })}
            text={(i) => t(`indicator.${i}`)}
          />
          <GoalsScatter
            rows={vs.rows}
            indicator={p.indicator}
            thresholds={outliers.thresholds}
            hrefFor={(r) => `/${locale}${assessmentOf(r.participantId)}`}
          />
        </Panel>
      ) : null}
      <Panel
        id="goals-buckets"
        title={t("buckets.title")}
        hint={t("buckets.hint")}
      >
        <BucketsChart data={vs} />
      </Panel>
      <Panel
        id="goal-outliers"
        title={t("outliers.title")}
        actions={csv("insights-goal-outliers")}
      >
        <OutliersView data={outliers} />
      </Panel>
      {vs.rows.length > 0 ? (
        <Panel id="goal-people" title={t("people.title")}>
          <PeopleSearch
            value={who}
            shown={people.length}
            total={vs.rows.length}
            hidden={{ ...shown, groupBy, indicator: p.indicator }}
            clearHref={`${hrefWith(here, shown)}#goal-people`}
          />
          <PeopleTable
            rows={people}
            hrefFor={(r) => assessmentOf(r.participantId)}
          />
        </Panel>
      ) : null}
    </div>
  );
}

export default function GoalsInsightsPage(
  props: PageProps<"/[locale]/insights/goals">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <GoalsInsights {...props} />
      </Suspense>
    </main>
  );
}
