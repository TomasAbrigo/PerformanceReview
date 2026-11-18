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
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { CycleForm } from "@/components/insights/cycle-form";
import { SelfAssessmentView } from "@/components/insights/self-assessment-view";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { insightsScope } from "@/modules/insights/authz";
import { selfAssessmentReport } from "@/modules/insights/self-assessment";
import { listCycles } from "@/modules/review-core";
import { dimensionLabels } from "../dimension-labels";
import { DrillSection } from "../drill-section";
import { drillBase } from "@/components/drill/drill-link";
import { parseDrill } from "@/modules/insights/drill-spec";
import { kpiThresholds } from "@/modules/insights/tone";
import { getSettings } from "@/modules/settings";

async function SelfAssessment({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/self-assessment">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Insights");
  const kicker = await groupKicker("insights");
  if (insightsScope(actor).kind === "none") return <p>{t("forbidden")}</p>;
  const sp = await searchParams;
  const groupBy = sp.groupBy === "manager" ? "manager" : "department";
  const cycles = localizeCycles(await listCycles(db), locale).filter(
    (c) => c.status !== "draft",
  );
  const cycle = cycles.find((c) => c.id === sp.cycle) ?? cycles[0];
  if (!cycle) return <EmptyState>{t("noCycles")}</EmptyState>;
  const report = await selfAssessmentReport(db, actor, {
    cycleId: cycle.id,
    groupBy,
  });
  const settings = await getSettings(db);
  // Drill-down (drill-section.tsx): completion and comment marks.
  const base = drillBase("/insights/self-assessment", sp, actor);
  const parsed = parseDrill(sp.drill);
  const drill =
    parsed?.kind === "completion" || parsed?.kind === "comments"
      ? parsed
      : null;
  const dimensionLabel = await dimensionLabels(
    report.sentimentGap.map((g) => g.dimension),
  );
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={
          <>
            {t("SelfAssessment.title")} · {cycle.name}
          </>
        }
        actions={
          actor.role === "hr" ? (
            <ExportCsvLink
              file="insights-self-assessment"
              params={{ cycle: cycle.id }}
            />
          ) : undefined
        }
      >
        <CycleForm
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          cycleId={cycle.id}
          groupBy={groupBy}
        />
      </PageHeader>
      <SelfAssessmentView
        report={report}
        dimensionLabel={dimensionLabel}
        groupBy={groupBy}
        base={base}
        cycleId={cycle.id}
        thresholds={kpiThresholds(settings)}
      />
      {drill ? (
        <Suspense fallback={null}>
          <DrillSection
            actor={actor}
            cycleId={cycle.id}
            drill={drill}
            base={base}
            minGroupSize={settings["aggregation.minGroupSize"]}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default function SelfAssessmentPage(
  props: PageProps<"/[locale]/insights/self-assessment">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <SelfAssessment {...props} />
      </Suspense>
    </main>
  );
}
