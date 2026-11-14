import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Panel } from "@/components/dashboards/parts";
import { TrajectoryChart } from "@/components/dashboards/trajectory-chart";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { personTrajectory } from "@/modules/analytics/dashboards";
import { ReviewError } from "@/modules/review-core";

async function Trajectory({
  params,
}: PageProps<"/[locale]/dashboards/people/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Dashboards");
  const data = await personTrajectory(db, actor, id).catch(forbiddenAsNull);
  if (!data) return <p>{t("forbidden")}</p>;
  return (
    <Panel
      id="trajectory"
      title={t("trajectory.title", { name: data.personName })}
    >
      <TrajectoryChart data={data} />
    </Panel>
  );
}

/** forbidden -> null (shown as a message), not_found -> 404. */
function forbiddenAsNull(error: unknown): null {
  if (!(error instanceof ReviewError)) throw error;
  if (error.code === "not_found") notFound();
  return null;
}

export default function TrajectoryPage(
  props: PageProps<"/[locale]/dashboards/people/[id]">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Trajectory {...props} />
      </Suspense>
    </main>
  );
}
