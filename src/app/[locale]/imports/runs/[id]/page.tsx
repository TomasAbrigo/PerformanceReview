import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CycleDecisionForm } from "@/components/imports/cycle-decision";
import { HrOnly } from "@/components/access/hr-only";
import { HistoryResultLink } from "@/components/imports/history-link";
import { RunDetailView } from "@/components/ingest/run-detail";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { isReportEntity } from "@/modules/import-history/reprocess";
import { getHistoryImportResult } from "@/modules/import-history/results";
import { getRun } from "@/modules/ingest/runs-queries";
import { resumeImportRunAction } from "../../history/actions";

async function RunData({ params }: PageProps<"/[locale]/imports/runs/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const run = await getRun(db, id);
  if (!run) notFound();
  // Historical imports (Bamboo report rows mapped to cycles) have a result page.
  const history = isReportEntity(run.entity)
    ? await getHistoryImportResult(db, run.id)
    : null;
  return (
    <div className="flex flex-col gap-6">
      {history?.status === "needs_decision" && history.decision ? (
        <CycleDecisionForm
          runId={run.id}
          decision={history.decision}
          resume={resumeImportRunAction}
        />
      ) : null}
      {history ? (
        <div>
          <HistoryResultLink runId={run.id} />
        </div>
      ) : null}
      <RunDetailView run={run} />
    </div>
  );
}

export default function RunPage(
  props: PageProps<"/[locale]/imports/runs/[id]">,
) {
  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Suspense>
        <HrOnly>
          <RunData {...props} />
        </HrOnly>
      </Suspense>
    </main>
  );
}
