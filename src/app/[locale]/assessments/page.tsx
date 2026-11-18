import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AssessmentsFilters } from "@/components/assessments/assessments-filters";
import {
  ParticipantsTable,
  ProgressChips,
} from "@/components/assessments/participants-table";
import { parseAssessmentsParams } from "@/components/assessments/url-state";
import { Panel } from "@/components/insights/parts";
import { orgFiltersOf } from "@/components/org/params";
import { PageHeader } from "@/components/page-header";
import { listHref } from "@/components/query-string";
import { db } from "@/db/client";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { individualScope } from "@/modules/actor/individual-scope";
import { getActor } from "@/modules/actor/server";
import {
  assessmentFilterOptions,
  listAssessmentCycles,
  listAssessmentParticipants,
} from "@/modules/assessments";
import { noOrgOptions } from "@/modules/org-attributes/kinds";
import { cycleName, localizeCycles } from "@/modules/review-core/cycle-name";
import { listPendingSelfReviews } from "@/modules/review-capture";
import { PendingReviews } from "@/components/assessments/pending-reviews";

const HERE = "/assessments";

async function AssessmentsList({
  params,
  searchParams,
}: PageProps<"/[locale]/assessments">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const scope = individualScope(actor);
  // Direction reads assessments as aggregates only: that is the analysis.
  if (actor.role === "direction") {
    return redirect({ href: "/insights/completion", locale });
  }
  const t = await getTranslations("Assessments");
  const header = (description: string) => (
    <PageHeader
      kicker={t("kicker")}
      title={t("title")}
      description={description}
    />
  );
  if (scope.kind === "none") return header(t("noPerson"));
  const ownOnly = scope.kind === "own";
  const p = parseAssessmentsParams(await searchParams);
  // The actor's own self assessments to complete, above the list.
  const pending = (await listPendingSelfReviews(db, actor)).map((r) => ({
    requestId: r.requestId,
    dueDate: r.dueDate,
    cycleName: cycleName(
      { name: r.cycleName, localizedName: r.localizedName },
      locale,
    ),
  }));
  // Latest cycle by default (the list comes latest period first).
  const cycles = localizeCycles(await listAssessmentCycles(db, actor), locale);
  if (cycles.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        {header(ownOnly ? t("noParticipants") : t("noCycles"))}
        <PendingReviews items={pending} />
      </div>
    );
  }
  const cycle = cycles.find((c) => c.id === p.cycle) ?? cycles[0];
  const [page, options] = await Promise.all([
    listAssessmentParticipants(db, actor, cycle.id, {
      progress: p.progress,
      q: ownOnly ? undefined : p.q,
      department: ownOnly ? undefined : p.department,
      ...(ownOnly ? {} : orgFiltersOf(p)),
      page: p.page,
    }),
    ownOnly
      ? { departments: [], org: noOrgOptions }
      : assessmentFilterOptions(db, actor, cycle.id),
  ]);
  const hrefFor = listHref(HERE, {
    cycle: cycle.id,
    progress: p.progress,
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
        <AssessmentsFilters
          params={p}
          cycleId={cycle.id}
          cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          options={options}
          ownOnly={ownOnly}
        />
      </PageHeader>
      <PendingReviews items={pending} />
      <Panel
        id="assessments-list"
        title={`${cycle.name} · ${t("count", { n: page.total })}`}
        actions={
          <ProgressChips
            counts={page.counts}
            current={p.progress}
            hrefFor={(progress) => hrefFor({ progress })}
          />
        }
      >
        <ParticipantsTable
          cycleId={cycle.id}
          page={page}
          showPeople={!ownOnly}
          hrefForPage={(n) => hrefFor({ page: n })}
        />
      </Panel>
    </div>
  );
}

export default function AssessmentsPage(
  props: PageProps<"/[locale]/assessments">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <AssessmentsList {...props} />
      </Suspense>
    </main>
  );
}
