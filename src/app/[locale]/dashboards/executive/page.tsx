import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExecutiveView } from "@/components/dashboards/executive-view";
import { parseParams } from "@/components/dashboards/url-state";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { executiveSummary } from "@/modules/analytics/dashboards";
import { listCycles } from "@/modules/review-core";

async function Executive({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboards/executive">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Dashboards");
  if (actor.role !== "hr") return <p>{t("forbidden")}</p>;
  const p = parseParams(await searchParams);
  const cycles = (await listCycles(db)).filter((c) => c.status !== "draft");
  const cycle = cycles.find((c) => c.id === p.cycle) ?? cycles[0];
  if (!cycle) return <p>{t("noCycles")}</p>;
  const data = await executiveSummary(db, actor, { cycleId: cycle.id });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {t("executive.title")} · {cycle.name}
      </h1>
      <ExecutiveView data={data} />
    </div>
  );
}

export default function ExecutivePage(
  props: PageProps<"/[locale]/dashboards/executive">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Executive {...props} />
      </Suspense>
    </main>
  );
}
