import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { CommentsTable } from "@/components/qualitative/comments-table";
import { QualitativeFilters } from "@/components/qualitative/filters";
import { ImportLabelsForm } from "@/components/qualitative/import-form";
import {
  dimensionLabels,
  KNOWN_DIMENSIONS,
} from "@/components/qualitative/dimension-labels";
import {
  parseQualitativeParams,
  withSide,
} from "@/components/qualitative/params";
import { SideToggle } from "@/components/qualitative/side-toggle";
import { RunButton } from "@/components/qualitative/run-button";
import {
  ByDimension,
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
import {
  listComments,
  qualitativeFilterOptions,
  sentimentByDimension,
  sentimentTotals,
  sentimentTrend,
  sentimentVsIndicators,
  topThemes,
  type QualitativeFilters as Filters,
} from "@/modules/qualitative-analysis";
import { listCycles } from "@/modules/review-core";
import { getSetting } from "@/modules/settings/service";
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
  const p = parseQualitativeParams(await searchParams);
  const cycles = (await listCycles(db))
    .filter((c) => c.status !== "draft")
    .map((c) => ({ id: c.id, name: c.name }));
  const cycleId = p.cycle && isUuid(p.cycle) ? p.cycle : undefined;
  const f: Filters = {
    cycleId,
    department: p.department,
    dimension: p.dimension,
    sentiment: p.sentiment,
    theme: p.theme,
    relationship: p.side,
    includeClosed: await getSetting(db, "analysis.includeClosed"),
    aggregateOnly: p.aggregate,
  };
  const [options, totals, byDimension, trend, themes, indicators, comments] =
    await Promise.all([
      qualitativeFilterOptions(db),
      sentimentTotals(db, actor, f),
      sentimentByDimension(db, actor, f),
      sentimentTrend(db, actor, f),
      topThemes(db, actor, f),
      sentimentVsIndicators(db, actor, f),
      listComments(db, actor, f),
    ]);
  const tDim = await getTranslations("Qualitative.dimensions");
  const dimensionLabel = dimensionLabels(options.dimensions, {
    names: Object.fromEntries(KNOWN_DIMENSIONS.map((k) => [k, tDim(k)])),
    custom: (n) => t("customDimension", { n }),
    prompts: options.dimensionPrompts,
    locale,
  });
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
      />
      {hr ? (
        <ExportCsvLink
          file="insights-sentiment"
          params={{
            cycle: cycleId,
            department: p.department,
            relationship: p.side,
          }}
        />
      ) : null}
      <Kpis counts={totals} />
      <ByDimension rows={byDimension} dimensionLabel={dimensionLabel} />
      <Trend points={trend} />
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
