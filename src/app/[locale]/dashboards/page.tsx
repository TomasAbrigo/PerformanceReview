import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FiltersForm, Toggle } from "@/components/dashboards/controls";
import { GapChart } from "@/components/dashboards/gap-chart";
import { GoalsScatter } from "@/components/dashboards/goals-scatter";
import { Panel } from "@/components/dashboards/parts";
import { ProgressChart } from "@/components/dashboards/progress-chart";
import { RatingHistogram } from "@/components/dashboards/rating-histogram";
import { hrefWith, parseParams } from "@/components/dashboards/url-state";
import { db } from "@/db/client";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  cycleProgress,
  type DashboardFilters,
  dashboardFilterOptions,
  goalsVsRating,
  groupBys,
  hierarchies,
  ratingDistribution,
  ratingStages,
  selfManagerGap,
} from "@/modules/analytics/dashboards";
import { listCycles } from "@/modules/review-core";

async function Dashboards({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboards">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Dashboards");
  if (actor.role !== "hr" && actor.role !== "manager") {
    if (actor.personId) {
      redirect({ href: `/dashboards/people/${actor.personId}`, locale });
    }
    return <p>{t("forbidden")}</p>;
  }
  if (actor.role === "manager" && !actor.personId) {
    return <p>{t("forbidden")}</p>;
  }
  const p = parseParams(await searchParams);
  const cycles = (await listCycles(db)).filter((c) => c.status !== "draft");
  if (!cycles.length) return <p>{t("noCycles")}</p>;
  const cycleId =
    p.cycle === "all"
      ? undefined
      : (cycles.find((c) => c.id === p.cycle) ?? cycles[0]).id;
  const shown = { ...p, cycle: p.cycle === "all" ? "all" : cycleId };
  const f: DashboardFilters = {
    cycleId,
    hierarchy: p.hierarchy,
    department: p.department,
    managerId: p.manager,
    location: p.location,
    jobTitle: p.jobTitle,
  };
  const [options, dist, progress, goals, gap] = await Promise.all([
    dashboardFilterOptions(db, actor, f),
    ratingDistribution(db, actor, { ...f, groupBy: p.groupBy, stage: p.stage }),
    cycleId ? cycleProgress(db, actor, f) : null,
    cycleId ? goalsVsRating(db, actor, f) : null,
    cycleId ? selfManagerGap(db, actor, f) : null,
  ]);
  const here = "/dashboards";
  const pickCycle = (
    <p className="text-sm text-muted-foreground">{t("pickCycle")}</p>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <nav className="flex gap-3 text-sm">
          <Link
            className="underline"
            href={hrefWith("/dashboards/team", shown)}
          >
            {t("team.link")}
          </Link>
          {actor.role === "hr" && cycleId ? (
            <Link
              className="underline"
              href={hrefWith("/dashboards/executive", { cycle: cycleId })}
            >
              {t("executive.link")}
            </Link>
          ) : null}
        </nav>
      </div>
      <FiltersForm
        params={shown as typeof p}
        cycles={[
          { id: "all", name: t("filters.allCycles") },
          ...cycles.map((c) => ({ id: c.id, name: c.name })),
        ]}
        options={options}
      />
      <Toggle
        label={t("hierarchy.label")}
        options={hierarchies}
        current={p.hierarchy}
        hrefFor={(h) => hrefWith(here, shown, { hierarchy: h })}
        text={(h) => t(`hierarchy.${h}`)}
      />
      <Panel
        id="progress"
        title={t("progress.title")}
        hint={progress ? t("phase", { phase: progress.status }) : undefined}
      >
        {progress ? <ProgressChart data={progress} /> : pickCycle}
      </Panel>
      <Panel
        id="distribution"
        title={t("distribution.title")}
        hint={t("distribution.hint")}
      >
        <div className="flex flex-wrap gap-4">
          <Toggle
            label={t("groupBy.label")}
            options={groupBys}
            current={p.groupBy}
            hrefFor={(g) => hrefWith(here, shown, { groupBy: g })}
            text={(g) => t(`groupBy.${g}`)}
          />
          <Toggle
            label={t("stage.label")}
            options={ratingStages}
            current={p.stage}
            hrefFor={(s) => hrefWith(here, shown, { stage: s })}
            text={(s) => t(`stage.${s}`)}
          />
        </div>
        <RatingHistogram data={dist} />
      </Panel>
      <Panel id="goals" title={t("goals.title")}>
        {goals ? <GoalsScatter rows={goals.rows} /> : pickCycle}
      </Panel>
      <Panel id="gap" title={t("gap.title")} hint={t("gap.hint")}>
        {gap ? <GapChart data={gap} /> : pickCycle}
      </Panel>
    </div>
  );
}

export default function DashboardsPage(
  props: PageProps<"/[locale]/dashboards">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Dashboards {...props} />
      </Suspense>
    </main>
  );
}
