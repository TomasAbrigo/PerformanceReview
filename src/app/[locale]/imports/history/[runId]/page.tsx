import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HistoryResult } from "@/components/imports/history-result";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getHistoryImportResult } from "@/modules/import-history/results";

async function HistoryData({
  params,
}: PageProps<"/[locale]/imports/history/[runId]">) {
  const { locale, runId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const result = await getHistoryImportResult(db, runId);
  if (!result) notFound();
  return <HistoryResult result={result} />;
}

export default function HistoryImportPage(
  props: PageProps<"/[locale]/imports/history/[runId]">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense>
        <HistoryData {...props} />
      </Suspense>
    </main>
  );
}
