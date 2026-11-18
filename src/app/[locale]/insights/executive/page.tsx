import { EmptyState } from "@/components/experience";
import { PageSkeleton } from "@/components/experience";
import { localizeCycles } from "@/modules/review-core/cycle-name";
import { rememberedCycle } from "@/modules/review-core/remembered-cycle";
import { latestFirst, pickCycle } from "@/modules/review-core/current-cycle";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { CycleForm } from "@/components/insights/cycle-form";
import { OrgFilterFields } from "@/components/org/org-filter-fields";
import { orgFiltersOf, parseOrgParams } from "@/components/org/params";
import {
  ExecutiveReportView,
  ModeToggle,
} from "@/components/insights/executive-report-view";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { isHr } from "@/modules/actor/access";
import { getActor } from "@/modules/actor/server";
import { canSeeExecutiveView } from "@/modules/insights";
import { orgFilterOptions } from "@/modules/org-attributes";
import {
  executiveModes,
  executiveReport,
  type ExecutiveMode,
} from "@/modules/insights/executive";
import { listCycles } from "@/modules/review-core";
import { getSettings } from "@/modules/settings";
import { parseDrill } from "@/modules/insights/drill-spec";
import { drillBase } from "@/components/drill/drill-link";
import { dimensionLabels } from "../dimension-labels";
import { DrillSection } from "../drill-section";

async function Executive({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/executive">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Insights");
  const kicker = await groupKicker("insights");
  if (!canSeeExecutiveView(actor)) return <p>{t("forbidden")}</p>;
  const sp = await searchParams;
  const mode: ExecutiveMode = executiveModes.includes(sp.mode as ExecutiveMode)
    ? (sp.mode as ExecutiveMode)
    : "both";
  // Latest period first, whatever order the cycles were created in.
  const cycles = latestFirst(
    localizeCycles(await listCycles(db), locale).filter(
      (c) => c.status !== "draft",
    ),
  );
  const cycle = pickCycle(
    cycles,
    typeof sp.cycle === "string" ? sp.cycle : undefined,
    await rememberedCycle(),
  );
  if (!cycle) return <EmptyState>{t("noCycles")}</EmptyState>;
  const settings = await getSettings(db);
  const minGroupSize = settings["aggregation.minGroupSize"];
  // The org cuts are People's: direction reads the whole cycle.
  const hr = isHr(actor);
  const filters = hr ? orgFiltersOf(parseOrgParams(sp)) : {};
  // The cycle before (by period), for the deltas of the KPIs.
  const previousCycle = cycles
    .filter((c) => c.periodStart < cycle.periodStart)
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))[0];
  const [report, previous, org] = await Promise.all([
    executiveReport(db, actor, {
      cycleId: cycle.id,
      mode,
      minGroupSize,
      filters,
    }),
    previousCycle && mode !== "qualitative"
      ? executiveReport(db, actor, {
          cycleId: previousCycle.id,
          mode: "quantitative",
          minGroupSize,
          filters,
        })
      : null,
    hr ? orgFilterOptions(db, actor, { cycleId: cycle.id }) : null,
  ]);
  // Drill-down: `?drill=` opens the records behind a mark (drill-section.tsx).
  const base = drillBase("/insights/executive", sp, actor);
  const drill = parseDrill(sp.drill);
  const dimensionLabel = await dimensionLabels(
    report.sentiment?.map((r) => r.dimension) ?? [],
  );
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={
          <>
            {t("Executive.title")} · {cycle.name}
          </>
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <CycleForm
            cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
            cycleId={cycle.id}
            hidden={{ mode }}
          >
            <OrgFilterFields params={filters} options={org} />
          </CycleForm>
          <ModeToggle mode={mode} cycleId={cycle.id} filters={filters} />
        </div>
      </PageHeader>
      <ExecutiveReportView
        report={report}
        previous={previous}
        dimensionLabel={dimensionLabel}
        base={base}
        settings={settings}
      />
      {drill ? (
        <Suspense fallback={null}>
          <DrillSection
            actor={actor}
            cycleId={cycle.id}
            drill={drill}
            base={base}
            minGroupSize={minGroupSize}
            filters={filters}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default function ExecutivePage(
  props: PageProps<"/[locale]/insights/executive">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <Executive {...props} />
      </Suspense>
    </main>
  );
}
