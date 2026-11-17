import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CompletionSummaryView } from "@/components/completion/completion-view";
import {
  CompletionFilters,
  MissingStatusToggle,
} from "@/components/completion/completion-filters";
import { MissingTable } from "@/components/completion/missing-table";
import { parseCompletionParams } from "@/components/completion/params";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { Panel } from "@/components/dashboards/parts";
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
import { insightsScope } from "@/modules/insights";
import { getSetting } from "@/modules/settings";

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
  // The scope decides what is shown: People everything, a manager their
  // direct reports, direction aggregates; anybody else nothing.
  const scope = insightsScope(actor);
  if (scope.kind === "none") {
    return (
      <section className="flex flex-col gap-2" data-testid="no-access">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{t("forbidden")}</p>
      </section>
    );
  }
  const cycles = await completionCycles(db);
  if (!cycles.length) return <p>{t("noCycles")}</p>;
  const p = parseCompletionParams(await searchParams);
  const cycle = cycles.find((c) => c.id === p.cycle) ?? cycles[0];
  const masked = scope.kind === "aggregatesOnly";
  // The minimum group size is read once per request (it only masks direction).
  const minGroupSize = masked
    ? await getSetting(db, "aggregation.minGroupSize")
    : undefined;
  const groupBys: CompletionGroupBy[] = masked
    ? ["none", "department"]
    : ["none", "department", "manager"];
  const groupBy = groupBys.includes(p.groupBy) ? p.groupBy : "department";
  const shown = { ...p, cycle: cycle.id, groupBy };
  const filters = {
    cycleId: cycle.id,
    groupBy,
    hierarchy: p.hierarchy,
    department: p.department,
    managerId: p.manager,
    minGroupSize,
  };
  // The summary and the list of who is missing are read off the same rows.
  const [{ delta, missing }, options] = await Promise.all([
    completionOverview(db, actor, { ...filters, missingStatus: p.status }),
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
  };
  const hr = isHr(actor);
  const hint = masked
    ? t("hint.aggregates", { min: minGroupSize ?? 0 })
    : scope.kind === "directReports"
      ? t("hint.directReports")
      : t("hint.all");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {t("title")} · {cycle.name}
      </h1>
      <p className="text-sm text-muted-foreground">{hint}</p>
      <CompletionFilters
        params={shown}
        cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
        options={options}
        groupBys={groupBys}
      />
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
        <CompletionSummaryView data={delta} />
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
    </div>
  );
}

export default function CompletionPage(
  props: PageProps<"/[locale]/insights/completion">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Completion {...props} />
      </Suspense>
    </main>
  );
}
