import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Toggle } from "@/components/dashboards/controls";
import { Panel } from "@/components/dashboards/parts";
import { TeamView } from "@/components/dashboards/team-view";
import { hrefWith, parseParams } from "@/components/dashboards/url-state";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { hierarchies, managerTeam } from "@/modules/analytics/dashboards";
import { listCycles, personName, ReviewError } from "@/modules/review-core";

async function Team({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboards/team">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Dashboards");
  const p = parseParams(await searchParams);
  const managerId = p.manager ?? actor.personId ?? undefined;
  if (!managerId) return <p>{t("team.pickManager")}</p>;
  const cycles = (await listCycles(db)).filter((c) => c.status !== "draft");
  const cycleId = (cycles.find((c) => c.id === p.cycle) ?? cycles[0])?.id;
  if (!cycleId) return <p>{t("noCycles")}</p>;
  const data = await managerTeam(db, actor, {
    managerId,
    cycleId,
    hierarchy: p.hierarchy,
  }).catch(forbiddenAsNull);
  if (!data) return <p>{t("forbidden")}</p>;
  const name = (await personName(db, managerId)) ?? "";
  const shown = {
    cycle: cycleId,
    manager: managerId,
    hierarchy: p.hierarchy,
  };
  return (
    <Panel id="team" title={t("team.of", { name })}>
      <Toggle
        label={t("hierarchy.label")}
        options={hierarchies}
        current={p.hierarchy}
        hrefFor={(h) => hrefWith("/dashboards/team", shown, { hierarchy: h })}
        text={(h) => t(`hierarchy.${h}`)}
      />
      <TeamView data={data} />
    </Panel>
  );
}

/** forbidden -> null (shown as a message), not_found -> 404. */
function forbiddenAsNull(error: unknown): null {
  if (!(error instanceof ReviewError)) throw error;
  if (error.code === "not_found") notFound();
  return null;
}

export default function TeamDashboardPage(
  props: PageProps<"/[locale]/dashboards/team">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Team {...props} />
      </Suspense>
    </main>
  );
}
