import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import {
  getFormatter,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  GoalStateChips,
  GoalsTable,
  GoalsOverview,
} from "@/components/goals/goals-table";
import { GoalsFilters } from "@/components/goals/goals-filters";
import { parseGoalsParams } from "@/components/goals/url-state";
import { GoalFormDialog } from "@/components/goals/goal-form-dialog";
import { orgFiltersOf } from "@/components/org/params";
import { PageHeader } from "@/components/page-header";
import { listHref } from "@/components/query-string";
import { db } from "@/db/client";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { individualScope } from "@/modules/actor/individual-scope";
import { getActor } from "@/modules/actor/server";
import {
  goalFilterOptions,
  listGoalCycles,
  listGoals,
} from "@/modules/goals/browse";
import { listGoalOwnerOptions } from "@/modules/goals/write";
import { noOrgOptions } from "@/modules/org-attributes/kinds";
import { todayLocal } from "@/modules/org-history/dates";
import { localizeCycles } from "@/modules/review-core/cycle-name";
import { rememberedCycle } from "@/modules/review-core/remembered-cycle";
import { pickCycle } from "@/modules/review-core/current-cycle";
import { getSettings } from "@/modules/settings";
import { goalThresholds } from "@/modules/insights/tone";
import { ALL_CYCLES } from "@/components/goals/url-state";
import { createGoalAction } from "./actions";

const HERE = "/goals";

async function GoalsList({
  params,
  searchParams,
}: PageProps<"/[locale]/goals">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const scope = individualScope(actor);
  // Direction reads goals as aggregates only: that is the analysis.
  if (actor.role === "direction") {
    return redirect({ href: "/insights/goals", locale });
  }
  const t = await getTranslations("Goals");
  if (scope.kind === "none") {
    return (
      <PageHeader
        kicker={t("kicker")}
        title={t("title")}
        description={t("noPerson")}
      />
    );
  }
  const ownOnly = scope.kind === "own";
  const p = parseGoalsParams(await searchParams);
  const cycles = localizeCycles(await listGoalCycles(db, actor), locale);
  // The latest cycle by default (what is being followed now); `all` lifts it.
  const cycleId =
    p.cycle === ALL_CYCLES
      ? undefined
      : (p.cycle ?? pickCycle(cycles, undefined, await rememberedCycle())?.id);
  const [page, options, owners, settings] = await Promise.all([
    listGoals(db, actor, {
      cycleId,
      state: p.state,
      q: p.q,
      department: ownOnly ? undefined : p.department,
      ...(ownOnly ? {} : orgFiltersOf(p)),
      page: p.page,
    }),
    ownOnly
      ? { departments: [], org: noOrgOptions }
      : goalFilterOptions(db, actor),
    listGoalOwnerOptions(db, actor),
    getSettings(db),
  ]);
  const hrefFor = listHref(HERE, {
    cycle: p.cycle,
    state: p.state,
    q: p.q,
    department: p.department,
    ...orgFiltersOf(p),
  });
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t("kicker")}
        title={ownOnly ? t("titleOwn") : t("title")}
        description={t(`scope.${scope.kind}`)}
        actions={
          owners.length > 0 ? (
            <GoalFormDialog
              mode="create"
              owners={owners}
              save={createGoalAction}
            />
          ) : undefined
        }
      />
      <GoalsOverview
        counts={page.counts}
        thresholds={goalThresholds(settings)}
        hrefFor={(state) => hrefFor({ state })}
      />
      {page.asOf < todayLocal() ? (
        // The goals of a closed cycle are measured at its cut-off, not today.
        <p className="text-sm text-muted-foreground" data-testid="goals-as-of">
          {t("overview.frozenNote", {
            date: (await getFormatter()).dateTime(
              new Date(`${page.asOf}T00:00:00Z`),
              { dateStyle: "medium", timeZone: "UTC" },
            ),
          })}
        </p>
      ) : null}
      <section
        aria-label={t("count", { n: page.total })}
        className="space-y-6"
        data-testid="goals-list"
      >
        <h2 className="sr-only">{t("count", { n: page.total })}</h2>
        <div className="list-controls">
          <GoalStateChips
            counts={page.counts}
            current={p.state}
            hrefFor={(state) => hrefFor({ state })}
          />
          <GoalsFilters
            params={p}
            cycleId={cycleId}
            cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
            options={options}
            ownOnly={ownOnly}
          />
        </div>
        <GoalsTable
          page={page}
          showPerson={!ownOnly}
          cycleId={cycleId}
          hrefForPage={(n) => hrefFor({ page: n })}
        />
      </section>
    </div>
  );
}

export default function GoalsPage(props: PageProps<"/[locale]/goals">) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <GoalsList {...props} />
      </Suspense>
    </main>
  );
}
