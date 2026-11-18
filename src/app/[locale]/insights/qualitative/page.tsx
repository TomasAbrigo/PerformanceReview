import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { CommentsTable } from "@/components/qualitative/comments-table";
import { QualitativeFilters } from "@/components/qualitative/filters";
import { ImportLabelsForm } from "@/components/qualitative/import-form";
import { Toggle } from "@/components/dashboards/controls";
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
import { getSetting } from "@/modules/settings/service";
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
  const scope = insightsScope(actor);
  if (scope.kind === "none") return <p>{t("forbidden")}</p>;
  const individuals = canSeeIndividuals(actor);
  const hr = actor.role === "hr";
  // Direction does not filter by the people who lead a team (a DM, a Santex Lead).
  const p = withoutPersonFilters(
    parseQualitativeParams(await searchParams),
    scope.kind === "aggregatesOnly",
  );
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
    includeClosed: await getSetting(db, "analysis.includeClosed"),
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
  // The panel only appears when People have loaded org attributes.
  const hasOrg = Object.values(org).some((values) => values.length > 0);
  const dimensionLabel = await dimensionLabels(
    options.dimensions,
    options.dimensionPrompts,
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {hr ? <RunButton cycleId={cycleId} run={runAnalysisAction} /> : null}
      </div>
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
      {hr ? (
        <ExportCsvLink
          file="insights-sentiment"
          params={{
            cycle: cycleId,
            department: p.department,
            relationship: p.side,
            ...orgFiltersOf(p),
          }}
        />
      ) : null}
      <Kpis counts={totals} />
      <ByDimension rows={byDimension} dimensionLabel={dimensionLabel} />
      <Trend points={trend} />
      {hasOrg ? (
        <ByGroup rows={byGroup}>
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
      <Themes themes={themes} />
      <Indicators rows={indicators} />
      {individuals && !p.aggregate ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("comments.title")}</h2>
          <CommentsTable
            rows={comments}
            dimensionLabel={dimensionLabel}
            correct={hr ? correctLabelAction : undefined}
          />
        </section>
      ) : null}
      {hr ? <ImportLabelsForm importLabels={importLabelsAction} /> : null}
    </div>
  );
}

export default function QualitativePage(
  props: PageProps<"/[locale]/insights/qualitative">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Qualitative {...props} />
      </Suspense>
    </main>
  );
}
