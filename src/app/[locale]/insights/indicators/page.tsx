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
  const p = withoutPersonFilters(
    parseIndicatorParams(await searchParams),
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
  const { options, distribution, matrix, alerts } = await indicatorOverview(
    db,
    actor,
    {
      cycleId: cycle.id,
      indicator: p.indicator,
      groupBy,
      hierarchy: p.hierarchy,
      filters: {
        department: p.department,
        managerId: p.manager,
        ...orgFiltersOf(p),
      },
    },
  );
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
        <DistributionView data={distribution} />
      </Panel>
      <Panel
        id="matrix"
        title={t("matrix.title")}
        hint={t("matrix.hint")}
        meta={cycle.name}
      >
        <RiskMatrixView matrix={matrix} />
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
        <AlertsView data={alerts} />
      </Panel>
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
