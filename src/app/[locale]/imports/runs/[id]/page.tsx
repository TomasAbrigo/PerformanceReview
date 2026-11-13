import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RunDetailView } from "@/components/ingest/run-detail";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getRun } from "@/modules/ingest/runs-queries";

async function RunData({ params }: PageProps<"/[locale]/imports/runs/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const run = await getRun(db, id);
  if (!run) notFound();
  return <RunDetailView run={run} />;
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
