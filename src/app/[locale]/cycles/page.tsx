import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CyclesList } from "@/components/cycles/cycles-list";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { listCycles } from "@/modules/review-core";

async function CyclesData({ params }: PageProps<"/[locale]/cycles">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const cycles = await listCycles(db);
  return (
    <CyclesList
      cycles={cycles.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        participantCount: c.participantCount,
      }))}
    />
  );
}

export default function CyclesPage(props: PageProps<"/[locale]/cycles">) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <CyclesData {...props} />
      </Suspense>
    </main>
  );
}
