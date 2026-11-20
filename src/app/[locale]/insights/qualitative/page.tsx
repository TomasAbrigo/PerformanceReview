import { MetricCard, PageSkeleton } from "@/components/experience";
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
  AgreementPanel,
  ClosedQuestionsPanel,
  ManagerFeedbackPanel,
  MaskedReading,
  ProvenanceNote,
  SignalsPanel,
  SubstancePanel,
  ThemesSidePanel,
  TonePanel,
  YesNoPanel,
} from "@/components/qualitative/reading";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { canSeeIndividuals, insightsScope } from "@/modules/insights/authz";
import { orgFilterOptions } from "@/modules/org-attributes";
import { withoutPersonFilters } from "@/modules/org-attributes/kinds";
import {
  listComments,
  qualitativeFilterOptions,
  qualitativeGroupBys,
  qualitativeUniverse,
  type QualitativeGroupBy,
  type QualitativeFilters as Filters,
} from "@/modules/qualitative-analysis";
import {
  agreementBySide,
  bestWorkOptions,
  managerFeedbackByGroup,
  readingProvenance,
  signalSummary,
  signalsByGroup,
  signalsVsIndicators,
  substanceByQuestion,
  themesBySide,
  toneByQuestion,
  valuedDistribution,
  yesNoByGroup,
  yesNoRates,
  yesNoThemes,
  yesNoTrend,
} from "@/modules/qualitative-analysis/reading";
import { listCycles } from "@/modules/review-core";
import { latestFirst, pickCycle } from "@/modules/review-core/current-cycle";
import { localizeCycles } from "@/modules/review-core/cycle-name";
import { rememberedCycle } from "@/modules/review-core/remembered-cycle";
import { getSettings } from "@/modules/settings";
import { drillBase } from "@/components/drill/drill-link";
import type { CommentDrills } from "@/components/qualitative/views";
import { type CommentScope, parseDrill } from "@/modules/insights/drill-spec";
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
  const masked = scope.kind === "aggregatesOnly";
  const individuals = canSeeIndividuals(actor);
  const hr = actor.role === "hr";
  // Direction does not filter by the people who lead a team (a DM, a Santex Lead).
  const sp = await searchParams;
  const p = withoutPersonFilters(parseQualitativeParams(sp), masked);
  const settings = await getSettings(db);
  const minGroupSize = settings["aggregation.minGroupSize"];
  // One cycle across the app (#119); "all" is an explicit choice.
  const cycles = latestFirst(
    localizeCycles(await listCycles(db), locale).filter(
      (c) => c.status !== "draft",
    ),
  );
  const all = p.cycle === "all";
  const cycle = all
    ? undefined
    : pickCycle(cycles, p.cycle, await rememberedCycle());
  const cycleId = cycle?.id;
  const f: Filters = {
    cycleId,
    department: p.department,
    ...orgFiltersOf(p),
    dimension: p.dimension,
    sentiment: p.sentiment,
    theme: p.theme,
    relationship: p.side,
    aggregateOnly: p.aggregate,
    minGroupSize,
  };
  // Direction reads teams, not the people who lead them (a DM, a Santex Lead).
  const groupBys: readonly QualitativeGroupBy[] = masked
    ? qualitativeGroupBys.filter((g) => g !== "dm" && g !== "santex_lead")
    : qualitativeGroupBys;
  const groupBy =
    p.groupBy && groupBys.includes(p.groupBy) ? p.groupBy : "department";
  const [options, org, universe] = await Promise.all([
    qualitativeFilterOptions(db),
    orgFilterOptions(db, actor, { cycleId }),
    qualitativeUniverse(db, actor, f),
  ]);
  const [
    provenance,
    substance,
    managerFeedback,
    strengths,
    improvement,
    agreement,
    signals,
    signalGroups,
    signalIndicators,
    yesNo,
    yesNoCycles,
    yesNoGroups,
    initiatives,
    valued,
    bestWork,
    tone,
    comments,
  ] = universe.masked
    ? []
    : await Promise.all([
        readingProvenance(db, actor, f),
        substanceByQuestion(db, actor, f),
        managerFeedbackByGroup(db, actor, f, groupBy),
        themesBySide(db, actor, { ...f, dimension: "strengths" }),
        themesBySide(db, actor, { ...f, dimension: "improvement" }),
        agreementBySide(db, actor, f),
        signalSummary(db, actor, f),
        signalsByGroup(db, actor, f, groupBy),
        signalsVsIndicators(db, actor, f),
        yesNoRates(db, actor, f),
        yesNoTrend(db, actor, f),
        yesNoByGroup(db, actor, f, groupBy),
        yesNoThemes(db, actor, f),
        valuedDistribution(db, actor, f, groupBy),
        bestWorkOptions(db, actor, f),
        toneByQuestion(db, actor, f),
        listComments(db, actor, f),
      ]);
  // Drill-down (drill-section.tsx): every mark opens its records, narrowed by
  // the page's filters plus what the mark stands for. Not in the aggregate
  // view, which never lists comments.
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
  const drills: CommentDrills | undefined =
    p.aggregate || masked ? undefined : { base, scope: pageScope };
  const parsed = p.aggregate ? null : parseDrill(sp.drill);
  const drill =
    parsed?.kind === "comments" || parsed?.kind === "yesno" ? parsed : null;
  const groupScope = (key: string): CommentScope | null => {
    if (key.startsWith("unassigned")) return null;
    switch (groupBy) {
      case "department":
        return { department: key };
      case "santex_lead":
        return { santexLead: key };
      default:
        return { [groupBy]: key };
    }
  };
  const dimensions = [
    ...new Set([
      ...options.dimensions,
      ...(substance ?? []).map((r) => r.dimension),
      ...(yesNo ?? []).map((r) => r.dimension),
      "strengths",
      "improvement",
    ]),
  ];
  const dimensionLabel = await dimensionLabels(
    dimensions,
    options.dimensionPrompts,
  );
  // People's CSV of a panel, by the page's grouping and filters.
  const groupCsv = (file: string) =>
    hr ? (
      <ExportCsvLink
        file={file}
        label={t("byGroup.export")}
        params={{
          cycle: cycleId,
          groupBy,
          department: p.department,
          relationship: p.side,
          ...orgFiltersOf(p),
        }}
      />
    ) : null;
  const share = (n: number, of: number) =>
    of ? `${Math.round((n / of) * 100)} %` : "–";
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={
          <>
            {t("title")} · {cycle ? cycle.name : t("filters.allCycles")}
          </>
        }
        actions={
          hr ? (
            <>
              <ExportCsvLink
                file="insights-sentiment"
                params={{
                  cycle: cycleId,
                  dimension: p.dimension,
                  sentiment: p.sentiment,
                  theme: p.theme,
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
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          cycle={cycleId ?? "all"}
          departments={options.departments}
          dimensions={options.dimensions}
          themes={options.themes}
          dimensionLabel={dimensionLabel}
          showAggregate={hr}
          org={org}
        />
        <Toggle
          label={t("byGroup.groupBy")}
          options={groupBys}
          current={groupBy}
          hrefFor={(g) => withGroupBy(p, g)}
          text={(g) => t(`byGroup.groups.${g}`)}
        />
      </PageHeader>
      {universe.masked ? (
        <MaskedReading min={universe.minGroupSize} />
      ) : (
        <>
          <ProvenanceNote p={provenance ?? null} />
          <section
            aria-label={t("reading.kpis")}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            data-testid="qualitative-kpis"
          >
            <MetricCard
              featured
              label={t("reading.people")}
              value={universe.people ?? 0}
              note={t("reading.peopleKpiNote")}
            />
            <MetricCard
              label={t("reading.withAny")}
              value={share(signals?.withAny ?? 0, signals?.people ?? 0)}
              note={t("reading.signalsMeta", {
                n: signals?.withAny ?? 0,
                of: signals?.people ?? 0,
              })}
            />
            <MetricCard
              label={t("reading.notValued")}
              value={share(
                valued?.total?.notValued ?? 0,
                valued?.total?.people ?? 0,
              )}
              note={t("reading.notValuedNote", {
                n: valued?.total?.notValued ?? 0,
                of: valued?.total?.people ?? 0,
              })}
            />
          </section>
          <SubstancePanel
            rows={substance ?? []}
            dimensionLabel={dimensionLabel}
            drills={drills}
          />
          <ManagerFeedbackPanel
            rows={managerFeedback ?? []}
            drills={drills}
            drillScopeOf={groupScope}
          >
            {groupCsv("insights-sentiment-by")}
          </ManagerFeedbackPanel>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {strengths ? (
              <ThemesSidePanel
                id="themes-strengths"
                title={t("reading.themesOf", {
                  question: dimensionLabel.strengths,
                })}
                data={strengths}
                drills={drills}
              />
            ) : null}
            {improvement ? (
              <ThemesSidePanel
                id="themes-improvement"
                title={t("reading.themesOf", {
                  question: dimensionLabel.improvement,
                })}
                data={improvement}
                drills={drills}
              />
            ) : null}
          </div>
          {agreement ? (
            <AgreementPanel
              a={agreement}
              dimensionLabel={dimensionLabel}
              drills={drills}
            />
          ) : null}
          <SignalsPanel
            s={signals ?? null}
            byGroup={signalGroups ?? []}
            vsIndicators={signalIndicators ?? []}
            drills={drills}
            groupScope={groupScope}
            minGroupSize={minGroupSize}
          >
            {groupCsv("insights-sentiment-by")}
          </SignalsPanel>
          <YesNoPanel
            actions={groupCsv("insights-yes-no")}
            rows={yesNo ?? []}
            trend={yesNoCycles ?? []}
            byGroup={yesNoGroups ?? []}
            themes={initiatives ?? []}
            dimensionLabel={dimensionLabel}
            drillOf={
              masked || p.aggregate
                ? undefined
                : (dimension, side, answer) => ({
                    base,
                    drill: {
                      kind: "yesno",
                      dimension,
                      answer,
                      side,
                      cycle: cycleId ?? null,
                    },
                  })
            }
          />
          {valued ? (
            <ClosedQuestionsPanel
              valued={valued}
              bestWork={bestWork ?? null}
              actions={groupCsv("insights-closed-questions")}
            />
          ) : null}
          <TonePanel
            rows={tone ?? []}
            dimensionLabel={dimensionLabel}
            drills={drills}
          />
          {individuals && !p.aggregate ? (
            <Panel
              id="comments"
              kind="comments"
              title={t("comments.title")}
              meta={t("comments.count", { n: comments?.length ?? 0 })}
            >
              <CommentsTable
                rows={comments ?? []}
                dimensionLabel={dimensionLabel}
                correct={hr ? correctLabelAction : undefined}
              />
            </Panel>
          ) : null}
        </>
      )}
      {hr ? <ImportLabelsForm importLabels={importLabelsAction} /> : null}
      {drill ? (
        <Suspense fallback={null}>
          {/* A comments / yes-no drill carries its own cycle (or all of them). */}
          <DrillSection
            actor={actor}
            cycleId={cycleId ?? ""}
            drill={drill}
            base={base}
            minGroupSize={minGroupSize}
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
