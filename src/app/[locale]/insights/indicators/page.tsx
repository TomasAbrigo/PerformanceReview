import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Panel } from "@/components/dashboards/parts";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { AlertsView } from "@/components/indicators/alerts-view";
import { DistributionView } from "@/components/indicators/distribution-view";
import { IndicatorFiltersForm } from "@/components/indicators/filters";
import { RiskMatrixView } from "@/components/indicators/risk-matrix-view";
import { parseIndicatorParams } from "@/components/indicators/url-state";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  indicatorCycles,
  indicatorOverview,
} from "@/modules/analytics/indicators";
import { insightsScope } from "@/modules/insights";

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
  const scope = insightsScope(actor);
  if (scope.kind === "none") return <p>{t("forbidden")}</p>;
  const cycles = await indicatorCycles(db);
  if (!cycles.length) return <p>{t("noCycles")}</p>;
  const p = parseIndicatorParams(await searchParams);
  const cycle = cycles.find((c) => c.id === p.cycle) ?? cycles[0];
  const shown = { ...p, cycle: cycle.id };
  // One read of the rows, one authorization: the panels and the selects.
  const { options, distribution, matrix, alerts } = await indicatorOverview(
    db,
    actor,
    {
      cycleId: cycle.id,
      indicator: p.indicator,
      groupBy: p.groupBy,
      hierarchy: p.hierarchy,
      filters: { department: p.department, managerId: p.manager },
    },
  );
  // CSV exports go through the API (People's visibility): offered to People only.
  const isHr = actor.role === "hr";
  const indicator = t(`indicator.${p.indicator}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          {t("title")} · {cycle.name}
        </h1>
        <nav className="flex gap-3 text-sm">
          <Link className="underline" href="/insights/indicators/trend">
            {t("trend.link")}
          </Link>
        </nav>
      </div>
      {scope.kind === "directReports" ? (
        <p className="text-sm text-muted-foreground">
          {t("scope.directReports")}
        </p>
      ) : null}
      {scope.kind === "aggregatesOnly" ? (
        <p className="text-sm text-muted-foreground">
          {t("scope.aggregatesOnly", { min: distribution.minGroupSize ?? 0 })}
        </p>
      ) : null}
      <IndicatorFiltersForm
        params={shown}
        cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
        options={options}
      />
      <Panel
        id="distribution"
        title={t("distribution.title", { indicator })}
        hint={t("distribution.hint")}
        actions={
          isHr ? (
            <ExportCsvLink
              file="insights-indicator-distribution"
              params={{
                cycle: cycle.id,
                indicator: p.indicator,
                groupBy: p.groupBy,
                hierarchy: p.hierarchy,
                department: p.department,
                manager: p.manager,
              }}
            />
          ) : undefined
        }
      >
        <DistributionView data={distribution} />
      </Panel>
      <Panel id="matrix" title={t("matrix.title")} hint={t("matrix.hint")}>
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
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Indicators {...props} />
      </Suspense>
    </main>
  );
}
