import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
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
  if (insightsScope(actor).kind === "none") return <p>{t("forbidden")}</p>;
  const sp = await searchParams;
  const groupBy = sp.groupBy === "manager" ? "manager" : "department";
  const cycles = (await listCycles(db)).filter((c) => c.status !== "draft");
  const cycle = cycles.find((c) => c.id === sp.cycle) ?? cycles[0];
  if (!cycle) return <p>{t("noCycles")}</p>;
  const report = await selfAssessmentReport(db, actor, {
    cycleId: cycle.id,
    groupBy,
  });
  const dimensionLabel = await dimensionLabels(
    report.sentimentGap.map((g) => g.dimension),
  );
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {t("SelfAssessment.title")} · {cycle.name}
      </h1>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <CycleForm
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          cycleId={cycle.id}
          groupBy={groupBy}
        />
        {actor.role === "hr" ? (
          <ExportCsvLink
            file="insights-self-assessment"
            params={{ cycle: cycle.id }}
          />
        ) : null}
      </div>
      <SelfAssessmentView
        report={report}
        dimensionLabel={dimensionLabel}
        groupBy={groupBy}
      />
    </div>
  );
}

export default function SelfAssessmentPage(
  props: PageProps<"/[locale]/insights/self-assessment">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <SelfAssessment {...props} />
      </Suspense>
    </main>
  );
}
