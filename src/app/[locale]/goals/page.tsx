import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
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
import { noOrgOptions } from "@/modules/org-attributes/kinds";
import { localizeCycles } from "@/modules/review-core/cycle-name";

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
  const [page, options] = await Promise.all([
    listGoals(db, actor, {
      cycleId: p.cycle,
      state: p.state,
      q: ownOnly ? undefined : p.q,
      department: ownOnly ? undefined : p.department,
      ...(ownOnly ? {} : orgFiltersOf(p)),
      page: p.page,
    }),
    ownOnly
      ? { departments: [], org: noOrgOptions }
      : goalFilterOptions(db, actor),
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
        title={t("title")}
        description={t(`scope.${scope.kind}`)}
      >
        <GoalsFilters
          params={p}
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          options={options}
          ownOnly={ownOnly}
        />
      </PageHeader>
      <GoalsOverview counts={page.counts} />
      <section
        aria-label={t("count", { n: page.total })}
        className="space-y-6"
        data-testid="goals-list"
      >
        <h2 className="text-xl">{t("count", { n: page.total })}</h2>
        <GoalStateChips
          counts={page.counts}
          current={p.state}
          hrefFor={(state) => hrefFor({ state })}
        />
        <GoalsTable
          page={page}
          showPerson={!ownOnly}
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
