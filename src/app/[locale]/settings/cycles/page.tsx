import { RefreshCw } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HrOnly } from "@/components/access/hr-only";
import { CreateCycleForm } from "@/components/cycles/create-cycle-form";
import { CardCollection } from "@/components/card-collection";
import { EmptyState, IconTile, PageSkeleton } from "@/components/experience";
import { Panel } from "@/components/insights/parts";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  periodCycleName,
  semesterConfig,
  semesterOf,
} from "@/modules/import-history/semester";
import { todayLocal } from "@/modules/org-history/dates";
import { listCycles } from "@/modules/review-core";
import { cycleName } from "@/modules/review-core/cycle-name";
import { createCycleAction } from "./actions";
import { statusKey } from "./status-key";

import { getActor } from "@/modules/actor/server";
import {
  type AssessmentListPage,
  listAssessmentParticipants,
} from "@/modules/assessments";
import { ProgressBar } from "@/components/progress-bar";

async function Cycles({ params }: PageProps<"/[locale]/settings/cycles">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("Cycles");
  const kicker = await groupKicker("settings");
  // Latest period first, each with where its assessments stand.
  const cycles = (await listCycles(db)).sort((a, b) =>
    b.periodEnd.localeCompare(a.periodEnd),
  );
  const actor = await getActor();
  const progress = new Map(
    await Promise.all(
      cycles
        .filter((c) => c.status !== "draft")
        .map(
          async (c) =>
            [
              c.id,
              (await listAssessmentParticipants(db, actor, c.id)).counts,
            ] as const,
        ),
    ),
  );
  // The suggested period: the semester of today, from the configured cuts.
  const semester = semesterOf(todayLocal(), await semesterConfig(db));
  const defaults = {
    name: periodCycleName(semester.periodStart, semester.periodEnd),
    periodStart: semester.periodStart,
    periodEnd: semester.periodEnd,
  };
  return (
    <>
      <PageHeader
        kicker={kicker}
        title={t("title")}
        description={t("description")}
      />
      <Panel id="cycles-new" title={t("create.title")}>
        <CreateCycleForm defaults={defaults} create={createCycleAction} />
      </Panel>
      <Panel id="cycles-list" title={t("list.title")}>
        {cycles.length === 0 ? (
          <EmptyState>{t("list.empty")}</EmptyState>
        ) : (
          <CardCollection>
            {cycles.map((c) => (
              <article key={c.id} className="record-card">
                <header className="flex items-center justify-between gap-3">
                  <IconTile>
                    <RefreshCw className="size-5" />
                  </IconTile>
                  <span
                    className="tone-pill"
                    data-tone={
                      c.status === "draft"
                        ? "watch"
                        : c.status === "closed"
                          ? undefined
                          : "good"
                    }
                  >
                    {t(`status.${statusKey(c.status)}`)}
                  </span>
                </header>
                <h3 className="text-xl">
                  <Link
                    href={`/settings/cycles/${c.id}`}
                    className="underline decoration-brand-200 underline-offset-4"
                  >
                    {cycleName(c, locale)}
                  </Link>
                </h3>
                <dl className="flex flex-col gap-1 text-sm text-muted-foreground">
                  <div>
                    <dt className="sr-only">{t("list.columns.period")}</dt>
                    <dd>
                      {c.periodStart} – {c.periodEnd}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">
                      {t("list.columns.participants")}
                    </dt>
                    <dd>
                      {t("list.participants", { count: c.participantCount })}
                    </dd>
                  </div>
                </dl>
                <CycleProgress counts={progress.get(c.id)} />
              </article>
            ))}
          </CardCollection>
        )}
      </Panel>
    </>
  );
}

/** How many participants have both assessments in, as a bar with the count. */
async function CycleProgress({
  counts,
}: {
  counts: AssessmentListPage["counts"] | undefined;
}) {
  const t = await getTranslations("Cycles.list");
  if (!counts) return null;
  const total = counts.complete + counts.partial + counts.pending;
  const pct = total ? Math.round((counts.complete / total) * 100) : 0;
  return (
    <div className="mt-auto flex flex-col gap-1 pt-2">
      <ProgressBar
        percent={pct}
        label={t("complete", { done: counts.complete, total, pct })}
      />
      <p className="text-xs text-muted-foreground">
        {t("complete", { done: counts.complete, total, pct })}
      </p>
    </div>
  );
}

export default function CyclesPage(
  props: PageProps<"/[locale]/settings/cycles">,
) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <HrOnly>
          <Cycles {...props} />
        </HrOnly>
      </Suspense>
    </main>
  );
}
