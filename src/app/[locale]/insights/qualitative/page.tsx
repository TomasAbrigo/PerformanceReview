import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { CommentsTable } from "@/components/qualitative/comments-table";
import { QualitativeFilters } from "@/components/qualitative/filters";
import { ImportLabelsForm } from "@/components/qualitative/import-form";
import { Toggle } from "@/components/insights/controls";
import { Panel } from "@/components/insights/parts";
import { orgFiltersOf } from "@/components/org/params";
import {
  parseQualitativeParams,
  withGroupBy,
  withSide,
} from "@/components/qualitative/params";
import { SideToggle } from "@/components/qualitative/side-toggle";
import { RunButton } from "@/components/qualitative/run-button";
import {
  ByDimension,
  ByGroup,
  Indicators,
  Kpis,
  Themes,
  Trend,
} from "@/components/qualitative/views";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { isUuid } from "@/lib/uuid";
import { getActor } from "@/modules/actor/server";
import { canSeeIndividuals, insightsScope } from "@/modules/insights/authz";
import { orgFilterOptions } from "@/modules/org-attributes";
import { withoutPersonFilters } from "@/modules/org-attributes/kinds";
import {
  listComments,
  qualitativeFilterOptions,
  qualitativeGroupBys,
  type QualitativeGroupBy,
  sentimentByDimension,
  sentimentByGroup,
  sentimentTotals,
  sentimentTrend,
  sentimentVsIndicators,
  topThemes,
  type QualitativeFilters as Filters,
} from "@/modules/qualitative-analysis";
import { listCycles } from "@/modules/review-core";
import { getSettings } from "@/modules/settings";
import { drillBase } from "@/components/drill/drill-link";
import type { CommentDrills } from "@/components/qualitative/views";
import { type CommentScope, parseDrill } from "@/modules/insights/drill-spec";
import { kpiThresholds } from "@/modules/insights/tone";
import { DrillSection } from "../drill-section";
import { dimensionLabels } from "../dimension-labels";
import {
  correctLabelAction,
  importLabelsAction,
  runAnalysisAction,
} from "./actions";

async function Qualitative({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/qualitative">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Qualitative");
  const kicker = await groupKicker("insights");
  const scope = insightsScope(actor);
  if (scope.kind === "none") return <p>{t("forbidden")}</p>;
  const individuals = canSeeIndividuals(actor);
  const hr = actor.role === "hr";
  // Direction does not filter by the people who lead a team (a DM, a Santex Lead).
  const sp = await searchParams;
  const p = withoutPersonFilters(
    parseQualitativeParams(sp),
    scope.kind === "aggregatesOnly",
  );
  const settings = await getSettings(db);
  const cycles = (await listCycles(db))
    .filter((c) => c.status !== "draft")
    .map((c) => ({ id: c.id, name: c.name }));
  const cycleId = p.cycle && isUuid(p.cycle) ? p.cycle : undefined;
  const f: Filters = {
    cycleId,
    department: p.department,
    ...orgFiltersOf(p),
    dimension: p.dimension,
    sentiment: p.sentiment,
    theme: p.theme,
    relationship: p.side,
    includeClosed: settings["analysis.includeClosed"],
    aggregateOnly: p.aggregate,
  };
  // Direction reads teams, not the people who lead them (a DM, a Santex Lead).
  const groupBys: readonly QualitativeGroupBy[] =
    scope.kind === "aggregatesOnly"
      ? qualitativeGroupBys.filter((g) => g !== "dm" && g !== "santex_lead")
      : qualitativeGroupBys;
  const groupBy =
    p.groupBy && groupBys.includes(p.groupBy) ? p.groupBy : "account";
  const [
    options,
    org,
    totals,
    byDimension,
    trend,
    themes,
    indicators,
    comments,
    byGroup,
  ] = await Promise.all([
    qualitativeFilterOptions(db),
    orgFilterOptions(db, actor, { cycleId }),
    sentimentTotals(db, actor, f),
    sentimentByDimension(db, actor, f),
    sentimentTrend(db, actor, f),
    topThemes(db, actor, f),
    sentimentVsIndicators(db, actor, f),
    listComments(db, actor, f),
    sentimentByGroup(db, actor, f, groupBy),
  ]);
  // Drill-down (drill-section.tsx): every mark opens its comments, narrowed
  // by the page's filters plus what the mark stands for. Not in the
  // aggregate view, which never lists comments.
  const base = drillBase("/insights/qualitative", sp, actor);
  const pageScope: CommentScope = {
    cycle: cycleId,
    dimension: p.dimension,
    sentiment: p.sentiment,
    theme: p.theme,
    side: p.side,
    department: p.department,
    ...orgFiltersOf(p),
  };
  for (const k of Object.keys(pageScope) as (keyof CommentScope)[]) {
    if (pageScope[k] === undefined) delete pageScope[k];
  }
  const drills: CommentDrills | undefined = p.aggregate
    ? undefined
    : { base, scope: pageScope };
  // Only comment drills here: they carry their own cycle (or all of them).
  const parsed = p.aggregate ? null : parseDrill(sp.drill);
  const drill = parsed?.kind === "comments" ? parsed : null;
  const groupScope = (key: string): CommentScope | null => {
    if (key === "unassigned") return null;
    switch (groupBy) {
      case "department":
        return { department: key };
      case "santex_lead":
        return { santexLead: key };
      default:
        return { [groupBy]: key };
    }
  };
  // The cycle before the selected one, for the deltas of the KPIs.
  const at = cycleId ? trend.findIndex((c) => c.cycleId === cycleId) : -1;
  const previous =
    at > 0 ? { name: trend[at - 1].cycleName, counts: trend[at - 1] } : null;
  // The panel only appears when People have loaded org attributes.
  const hasOrg = Object.values(org).some((values) => values.length > 0);
  const dimensionLabel = await dimensionLabels(
    options.dimensions,
    options.dimensionPrompts,
  );
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={t("title")}
        actions={
          hr ? (
            <>
              <ExportCsvLink
                file="insights-sentiment"
                params={{
                  cycle: cycleId,
                  department: p.department,
                  relationship: p.side,
                  ...orgFiltersOf(p),
                }}
              />
              <RunButton cycleId={cycleId} run={runAnalysisAction} />
            </>
          ) : undefined
        }
      >
        <SideToggle current={p.side} hrefFor={(side) => withSide(p, side)} />
        <QualitativeFilters
          params={p}
          cycles={cycles}
          departments={options.departments}
          dimensions={options.dimensions}
          themes={options.themes}
          dimensionLabel={dimensionLabel}
          showAggregate={hr}
          org={org}
        />
      </PageHeader>
      <Kpis
        counts={totals}
        previous={previous}
        drills={drills}
        thresholds={kpiThresholds(settings)}
      />
      <ByDimension
        rows={byDimension}
        dimensionLabel={dimensionLabel}
        drills={drills}
      />
      <Trend points={trend} drills={drills} />
      {hasOrg ? (
        <ByGroup
          rows={byGroup}
          drills={scope.kind === "aggregatesOnly" ? undefined : drills}
          drillScopeOf={groupScope}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              label={t("byGroup.groupBy")}
              options={groupBys}
              current={groupBy}
              hrefFor={(g) => withGroupBy(p, g)}
              text={(g) => t(`byGroup.groups.${g}`)}
            />
            {hr ? (
              <ExportCsvLink
                file="insights-sentiment-by"
                label={t("byGroup.export")}
                params={{
                  cycle: cycleId,
                  groupBy,
                  department: p.department,
                  relationship: p.side,
                  ...orgFiltersOf(p),
                }}
              />
            ) : null}
          </div>
        </ByGroup>
      ) : null}
      <Themes themes={themes} total={totals?.total} drills={drills} />
      <Indicators rows={indicators} drills={drills} />
      {individuals && !p.aggregate ? (
        <Panel
          id="comments"
          kind="comments"
          title={t("comments.title")}
          meta={t("comments.count", { n: comments.length })}
        >
          <CommentsTable
            rows={comments}
            dimensionLabel={dimensionLabel}
            correct={hr ? correctLabelAction : undefined}
          />
        </Panel>
      ) : null}
      {hr ? <ImportLabelsForm importLabels={importLabelsAction} /> : null}
      {drill ? (
        <Suspense fallback={null}>
          {/* A comments drill carries its own cycle; the rest need one. */}
          <DrillSection
            actor={actor}
            cycleId={cycleId ?? ""}
            drill={drill}
            base={base}
            minGroupSize={settings["aggregation.minGroupSize"]}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default function QualitativePage(
  props: PageProps<"/[locale]/insights/qualitative">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <Qualitative {...props} />
      </Suspense>
    </main>
  );
}
