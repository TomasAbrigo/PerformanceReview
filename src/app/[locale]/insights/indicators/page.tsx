import { EmptyState } from "@/components/experience";
import { PageSkeleton } from "@/components/experience";
import { localizeCycles } from "@/modules/review-core/cycle-name";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { Panel } from "@/components/insights/parts";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { AlertsView } from "@/components/indicators/alerts-view";
import { DistributionView } from "@/components/indicators/distribution-view";
import { IndicatorFiltersForm } from "@/components/indicators/filters";
import { RiskMatrixView } from "@/components/indicators/risk-matrix-view";
import { parseIndicatorParams } from "@/components/indicators/url-state";
import { orgFiltersOf } from "@/components/org/params";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  type IndicatorGroupBy,
  indicatorCycles,
  indicatorGroupBys,
  indicatorOverview,
} from "@/modules/analytics/indicators";
import { insightsScope } from "@/modules/insights";
import { withoutPersonFilters } from "@/modules/org-attributes/kinds";
import { Gauge, ShieldAlert } from "lucide-react";
import { getFormatter } from "next-intl/server";
import { MetricCard } from "@/components/experience";
import { drillBase } from "@/components/drill/drill-link";
import { parseDrill } from "@/modules/insights/drill-spec";
import { atRiskTone, kpiThresholds, likertTone } from "@/modules/insights/tone";
import type { IndicatorDistribution } from "@/modules/analytics/indicators/types";
import { getSettings } from "@/modules/settings";
import { DrillSection } from "../drill-section";

/** The mean of everybody in a distribution (the total row, or the only one). */
const overallOf = (d: IndicatorDistribution) =>
  d.groupBy === "none" ? (d.series[0] ?? null) : d.total;

async function Indicators({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/indicators">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Indicators");
  const kicker = await groupKicker("insights");
  const scope = insightsScope(actor);
  if (scope.kind === "none") return <p>{t("forbidden")}</p>;
  const cycles = localizeCycles(await indicatorCycles(db), locale);
  if (!cycles.length) return <EmptyState>{t("noCycles")}</EmptyState>;
  // Direction does not filter by the people who lead a team (a DM, a Santex Lead).
  const sp = await searchParams;
  const p = withoutPersonFilters(
    parseIndicatorParams(sp),
    scope.kind === "aggregatesOnly",
  );
  const cycle = cycles.find((c) => c.id === p.cycle) ?? cycles[0];
  // Direction reads teams, not the people who lead them (a DM, a Santex Lead).
  const groupBys: readonly IndicatorGroupBy[] =
    scope.kind === "aggregatesOnly"
      ? indicatorGroupBys.filter((g) => g !== "dm" && g !== "santex_lead")
      : indicatorGroupBys;
  const groupBy = groupBys.includes(p.groupBy) ? p.groupBy : "department";
  const shown = { ...p, groupBy, cycle: cycle.id };
  // One read of the rows, one authorization: the panels and the selects.
  const input = {
    indicator: p.indicator,
    groupBy,
    hierarchy: p.hierarchy,
    filters: {
      department: p.department,
      managerId: p.manager,
      ...orgFiltersOf(p),
    },
  };
  // The cycle before (cycles come newest first), for the delta of the mean.
  const previousCycle = cycles[cycles.findIndex((c) => c.id === cycle.id) + 1];
  const [{ options, distribution, matrix, alerts }, previous, settings] =
    await Promise.all([
      indicatorOverview(db, actor, { cycleId: cycle.id, ...input }),
      previousCycle
        ? indicatorOverview(db, actor, { cycleId: previousCycle.id, ...input })
        : null,
      getSettings(db),
    ]);
  const masked = scope.kind === "aggregatesOnly";
  const targets = kpiThresholds(settings);
  const riskThreshold = settings["alerts.riskThreshold"];
  const minGroupSize = settings["aggregation.minGroupSize"];
  // Drill-down: `?drill=` opens the records behind a mark (drill-section.tsx).
  const base = drillBase("/insights/indicators", sp, actor);
  const drill = parseDrill(sp.drill);
  const format = await getFormatter();
  const dec = (v: number, signed = false) =>
    format.number(v, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      ...(signed ? { signDisplay: "exceptZero" as const } : {}),
    });
  const overall = overallOf(distribution);
  const before = previous ? overallOf(previous.distribution) : null;
  const meanDelta =
    overall?.mean != null && before?.mean != null
      ? overall.mean - before.mean
      : null;
  // CSV exports go through the API (People's visibility): offered to People only.
  const isHr = actor.role === "hr";
  const indicator = t(`indicator.${p.indicator}`);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={
          <>
            {t("title")} · {cycle.name}
          </>
        }
        description={
          scope.kind === "directReports"
            ? t("scope.directReports")
            : scope.kind === "aggregatesOnly"
              ? t("scope.aggregatesOnly", {
                  min: distribution.minGroupSize ?? 0,
                })
              : undefined
        }
        actions={
          <Link className="text-sm underline" href="/insights/indicators/trend">
            {t("trend.link")}
          </Link>
        }
      >
        <IndicatorFiltersForm
          params={shown}
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          options={options}
          groupBys={groupBys}
        />
      </PageHeader>
      <section
        className="grid gap-5 sm:grid-cols-2"
        aria-label={t("kpi.mean", { indicator })}
      >
        <MetricCard
          featured
          testId="indicators-kpi-mean"
          label={t("kpi.mean", { indicator })}
          icon={<Gauge className="size-5" />}
          value={overall?.mean == null ? "—" : dec(overall.mean)}
          status={
            overall?.mean == null
              ? undefined
              : likertTone(overall.mean, riskThreshold)
          }
          scale={
            overall?.mean == null
              ? undefined
              : {
                  value: overall.mean,
                  min: 1,
                  max: 5,
                  label: t("kpi.scale", {
                    indicator,
                    value: dec(overall.mean),
                  }),
                }
          }
          delta={
            meanDelta === null || !previousCycle
              ? undefined
              : {
                  value: meanDelta,
                  text: t("kpi.vs", {
                    delta: dec(meanDelta, true),
                    cycle: previousCycle.name,
                  }),
                }
          }
          drill={
            overall?.n
              ? {
                  base,
                  drill: {
                    kind: "indicator",
                    indicator: p.indicator,
                    value: null,
                  },
                  label: t("kpi.drillAll", { n: overall.n }),
                }
              : undefined
          }
          note={overall ? t("kpi.answered", { n: overall.n }) : undefined}
        />
        <MetricCard
          testId="indicators-kpi-risk"
          label={t("kpi.risk")}
          icon={<ShieldAlert className="size-5" />}
          value={matrix.riskCount ?? "—"}
          status={
            matrix.riskCount === null || matrix.total === null
              ? undefined
              : atRiskTone(matrix.riskCount, matrix.total, targets)
          }
          scale={
            matrix.riskCount === null || !matrix.total
              ? undefined
              : {
                  value: matrix.riskCount,
                  min: 0,
                  max: matrix.total,
                  label: t("kpi.riskScale", {
                    n: matrix.riskCount,
                    total: matrix.total,
                  }),
                }
          }
          drill={
            matrix.riskCount
              ? {
                  base,
                  drill: { kind: "risk", retention: "low", engagement: "low" },
                  label: t("alerts.riskDrill", { n: matrix.riskCount }),
                }
              : undefined
          }
          note={
            matrix.total === null
              ? undefined
              : t("kpi.riskOf", { total: matrix.total })
          }
        />
      </section>
      <Panel
        id="distribution"
        title={t("distribution.title", {
          indicator: indicator.toLowerCase(),
        })}
        meta={cycle.name}
        hint={t("distribution.hint")}
        actions={
          isHr ? (
            <ExportCsvLink
              file="insights-indicator-distribution"
              params={{
                cycle: cycle.id,
                indicator: p.indicator,
                groupBy,
                hierarchy: p.hierarchy,
                department: p.department,
                manager: p.manager,
                ...orgFiltersOf(p),
              }}
            />
          ) : undefined
        }
      >
        <DistributionView
          data={distribution}
          context={{ base, masked, smallN: minGroupSize }}
        />
      </Panel>
      <Panel
        id="matrix"
        title={t("matrix.title")}
        hint={t("matrix.hint")}
        meta={cycle.name}
      >
        <RiskMatrixView matrix={matrix} drill={base} />
      </Panel>
      <Panel
        id="alerts"
        title={t("alerts.title")}
        hint={t("alerts.hint", {
          drop: alerts.dropThreshold,
          risk: alerts.riskThreshold,
        })}
        actions={
          isHr ? (
            <ExportCsvLink
              file="insights-alerts"
              params={{
                cycle: cycle.id,
                hierarchy: p.hierarchy,
                department: p.department,
                manager: p.manager,
                ...orgFiltersOf(p),
              }}
            />
          ) : undefined
        }
      >
        <AlertsView
          data={alerts}
          context={{ base, targets, total: matrix.total }}
        />
      </Panel>
      {drill ? (
        <Suspense fallback={null}>
          <DrillSection
            actor={actor}
            cycleId={cycle.id}
            drill={drill}
            base={base}
            minGroupSize={minGroupSize}
            filters={masked ? {} : { ...orgFiltersOf(p) }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default function IndicatorsPage(
  props: PageProps<"/[locale]/insights/indicators">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <Indicators {...props} />
      </Suspense>
    </main>
  );
}
