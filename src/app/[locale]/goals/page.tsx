import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GoalStateChips, GoalsTable } from "@/components/goals/goals-table";
import { GoalsFilters } from "@/components/goals/goals-filters";
import {
  type GoalsParams,
  parseGoalsParams,
} from "@/components/goals/url-state";
import { Panel } from "@/components/insights/parts";
import { orgFiltersOf } from "@/components/org/params";
import { PageHeader } from "@/components/page-header";
import { queryString } from "@/components/query-string";
import { db } from "@/db/client";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { individualScope } from "@/modules/actor/individual-scope";
import { getActor } from "@/modules/actor/server";
import { listAssessmentCycles } from "@/modules/assessments";
import { goalFilterOptions, listGoals } from "@/modules/goals/browse";
import { noOrgOptions } from "@/modules/org-attributes/kinds";
import { localizeCycles } from "@/modules/review-core/cycle-name";

const HERE = "/goals";

/** The filters of the list as a query string, without the page. */
const filtersQuery = (p: GoalsParams) => ({
  cycle: p.cycle,
  state: p.state,
  q: p.q,
  department: p.department,
  account: p.account,
  project: p.project,
  dm: p.dm,
  santexLead: p.santexLead,
});

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
  const cycles = localizeCycles(await listAssessmentCycles(db, actor), locale);
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
  const hrefFor = (extra: Record<string, string | number | undefined>) =>
    `${HERE}${queryString({ ...filtersQuery(p), ...extra })}`;
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
      <Panel
        id="goals-list"
        title={t("count", { n: page.total })}
        actions={
          <GoalStateChips
            counts={page.counts}
            current={p.state}
            hrefFor={(state) => hrefFor({ state, page: undefined })}
          />
        }
      >
        <GoalsTable
          page={page}
          showPerson={!ownOnly}
          hrefForPage={(n) => hrefFor({ page: n })}
        />
      </Panel>
    </div>
  );
}

export default function GoalsPage(props: PageProps<"/[locale]/goals">) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <GoalsList {...props} />
      </Suspense>
    </main>
  );
}
