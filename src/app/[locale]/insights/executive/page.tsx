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
import { ExecutiveView } from "@/components/insights/executive-view";
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
import { executiveSummary } from "@/modules/analytics/dashboards";
import { canSeeExecutiveView } from "@/modules/insights";
import { orgFilterOptions } from "@/modules/org-attributes";
import {
  executiveModes,
  executiveReport,
  type ExecutiveMode,
} from "@/modules/insights/executive";
import { listCycles } from "@/modules/review-core";
import { getSetting } from "@/modules/settings";
import { dimensionLabels } from "../dimension-labels";

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
  const cycles = localizeCycles(await listCycles(db), locale).filter(
    (c) => c.status !== "draft",
  );
  const cycle = cycles.find((c) => c.id === sp.cycle) ?? cycles[0];
  if (!cycle) return <EmptyState>{t("noCycles")}</EmptyState>;
  const minGroupSize = await getSetting(db, "aggregation.minGroupSize");
  // The org cuts are People's: direction reads the whole cycle.
  const hr = isHr(actor);
  const filters = hr ? orgFiltersOf(parseOrgParams(sp)) : {};
  const [report, summary, org] = await Promise.all([
    executiveReport(db, actor, {
      cycleId: cycle.id,
      mode,
      minGroupSize,
      filters,
    }),
    mode === "qualitative"
      ? null
      : executiveSummary(db, actor, {
          cycleId: cycle.id,
          minGroupSize,
          filters,
        }),
    hr ? orgFilterOptions(db, actor, { cycleId: cycle.id }) : null,
  ]);
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
      <ExecutiveReportView report={report} dimensionLabel={dimensionLabel} />
      {summary ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-2xl">{t("Executive.ratings")}</h2>
          <ExecutiveView data={summary} showProgress={false} />
        </section>
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
