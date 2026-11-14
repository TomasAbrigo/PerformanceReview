import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HistoryResultLink } from "@/components/imports/history-link";
import { RunDetailView } from "@/components/ingest/run-detail";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getHistoryImportResult } from "@/modules/import-history/results";
import { getRun } from "@/modules/ingest/runs-queries";

async function RunData({ params }: PageProps<"/[locale]/imports/runs/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const run = await getRun(db, id);
  if (!run) notFound();
  // Historical imports (Bamboo report rows mapped to cycles) have a result page.
  const history =
    run.entity === "assessment" || run.entity === "feedback"
      ? await getHistoryImportResult(db, run.id)
      : null;
  return (
    <div className="flex flex-col gap-6">
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
        <RunData {...props} />
      </Suspense>
    </main>
  );
}
