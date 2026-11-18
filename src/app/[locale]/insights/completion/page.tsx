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
import { CompletionSummaryView } from "@/components/completion/completion-view";
import {
  CompletionFilters,
  MissingStatusToggle,
} from "@/components/completion/completion-filters";
import { MissingTable } from "@/components/completion/missing-table";
import { PeriodDetailTable } from "@/components/completion/period-detail-table";
import { parseCompletionParams } from "@/components/completion/params";
import { orgFiltersOf } from "@/components/org/params";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { Panel } from "@/components/insights/parts";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { isHr } from "@/modules/actor/access";
import { getActor } from "@/modules/actor/server";
import { canSeeEmail } from "@/modules/actor/types";
import {
  type CompletionGroupBy,
  completionCycles,
  completionOverview,
} from "@/modules/analytics/completion";
import { dashboardFilterOptions } from "@/modules/analytics/dashboards";
import { periodDetail } from "@/modules/analytics/period-detail";
import { insightsScope } from "@/modules/insights";
import { getSettings } from "@/modules/settings";
import { parseDrill } from "@/modules/insights/drill-spec";
import { kpiThresholds } from "@/modules/insights/tone";
import { drillBase } from "@/components/drill/drill-link";
import { DrillSection } from "../drill-section";

async function Completion({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/completion">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Completion");
  const kicker = await groupKicker("insights");
  // The scope decides what is shown: People everything, a manager their
  // direct reports, direction aggregates; anybody else nothing.
  const scope = insightsScope(actor);
  if (scope.kind === "none") {
    return (
      <section className="flex flex-col gap-2" data-testid="no-access">
        <h1>{t("title")}</h1>
        <p>{t("forbidden")}</p>
      </section>
    );
  }
  const cycles = localizeCycles(await completionCycles(db), locale);
  if (!cycles.length) return <EmptyState>{t("noCycles")}</EmptyState>;
  const sp = await searchParams;
  const p = parseCompletionParams(sp);
  const cycle = cycles.find((c) => c.id === p.cycle) ?? cycles[0];
  const masked = scope.kind === "aggregatesOnly";
  // The settings are read once per request: the minimum group size (it only
  // masks direction) and the thresholds of the tones.
  const settings = await getSettings(db);
  const minGroupSize = masked
    ? settings["aggregation.minGroupSize"]
    : undefined;
  // Drill-down: `?drill=` opens the records behind a mark (drill-section.tsx).
  const base = drillBase("/insights/completion", sp, actor);
  const drill = parseDrill(sp.drill);
  const targets = kpiThresholds(settings);
  // Direction reads areas, accounts and projects (a manager or DM is a person).
  const groupBys: CompletionGroupBy[] = masked
    ? ["none", "department", "account", "project"]
    : [
        "none",
        "department",
        "manager",
        "account",
        "project",
        "dm",
        "santex_lead",
      ];
  const groupBy = groupBys.includes(p.groupBy) ? p.groupBy : "department";
  const shown = { ...p, cycle: cycle.id, groupBy };
  const filters = {
    cycleId: cycle.id,
    groupBy,
    hierarchy: p.hierarchy,
    department: p.department,
    managerId: p.manager,
    ...orgFiltersOf(p),
    minGroupSize,
  };
  // The summary and the list of who is missing are read off the same rows.
  const [{ delta, missing }, detail, options] = await Promise.all([
    completionOverview(db, actor, { ...filters, missingStatus: p.status }),
    periodDetail(db, actor, {
      department: p.department,
      managerId: p.manager,
      ...orgFiltersOf(p),
      minGroupSize,
    }),
    masked
      ? null
      : dashboardFilterOptions(db, actor, {
          cycleId: cycle.id,
          hierarchy: p.hierarchy,
        }),
  ]);
  // CSV exports go through the API (HR visibility): offered to HR only.
  const csvParams = {
    cycle: cycle.id,
    hierarchy: p.hierarchy,
    department: p.department,
    manager: p.manager,
    ...orgFiltersOf(p),
  };
  const hr = isHr(actor);
  const hint = masked
    ? t("hint.aggregates", { min: minGroupSize ?? 0 })
    : scope.kind === "directReports"
      ? t("hint.directReports")
      : t("hint.all");
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={
          <>
            {t("title")} · {cycle.name}
          </>
        }
        description={hint}
      >
        <CompletionFilters
          params={shown}
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          options={options}
          groupBys={groupBys}
        />
      </PageHeader>
      <Panel
        id="completion-summary"
        title={t("summary.title")}
        actions={
          hr ? (
            <ExportCsvLink
              file="insights-completion"
              params={{ ...csvParams, groupBy }}
              label={t("export.csv")}
            />
          ) : undefined
        }
      >
        <CompletionSummaryView
          data={delta}
          context={{ base, groupBy, masked, targets }}
        />
      </Panel>
      <Panel
        id="completion-period-detail"
        title={t("period.title")}
        hint={masked ? t("period.hintAggregates") : t("period.hint")}
        actions={
          hr ? (
            <ExportCsvLink
              file="insights-period-detail"
              params={{
                department: p.department,
                manager: p.manager,
                ...orgFiltersOf(p),
              }}
              label={t("export.csv")}
            />
          ) : undefined
        }
      >
        <PeriodDetailTable
          data={{
            ...detail,
            rows: localizeCycles(
              detail.rows.map((r) => ({ ...r, name: r.cycleName })),
              locale,
            ).map(({ name, ...r }) => ({ ...r, cycleName: name })),
          }}
          context={{
            base,
            targets,
            riskThreshold: settings["alerts.riskThreshold"],
          }}
        />
      </Panel>
      <Panel
        id="completion-missing"
        title={t("missing.title")}
        hint={missing ? t("missing.hint") : undefined}
        actions={
          hr ? (
            <span className="flex flex-wrap gap-2">
              <ExportCsvLink
                file="insights-missing"
                params={{ ...csvParams, status: p.status }}
                label={t("export.csv")}
              />
              {canSeeEmail(actor.role) ? (
                <ExportCsvLink
                  file="insights-missing"
                  params={{
                    ...csvParams,
                    status: p.status,
                    include_email: "1",
                  }}
                  label={t("export.csvEmail")}
                />
              ) : null}
            </span>
          ) : undefined
        }
      >
        {missing ? (
          <>
            <MissingStatusToggle params={shown} />
            <MissingTable rows={missing} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("missing.directionOnly")}
          </p>
        )}
      </Panel>
      {drill ? (
        <Suspense fallback={null}>
          <DrillSection
            actor={actor}
            cycleId={cycle.id}
            drill={drill}
            base={base}
            minGroupSize={settings["aggregation.minGroupSize"]}
            filters={masked ? {} : orgFiltersOf(p)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default function CompletionPage(
  props: PageProps<"/[locale]/insights/completion">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <Completion {...props} />
      </Suspense>
    </main>
  );
}
