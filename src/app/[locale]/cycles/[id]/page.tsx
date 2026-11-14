import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CycleDetailView } from "@/components/cycles/cycle-detail";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  getCycle,
  listCycleGroups,
  listSelfRequests,
} from "@/modules/review-core";
import { listTemplates } from "@/modules/templates";
import {
  duplicateCycleAction,
  launchCycleAction,
  transitionCycleAction,
} from "../actions";
import { unlockAction } from "./self/actions";

async function Detail({ params }: PageProps<"/[locale]/cycles/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const cycle = await getCycle(db, id);
  if (!cycle) notFound();
  const actor = await getActor();
  const [groups, templates, selfRequests] = await Promise.all([
    listCycleGroups(db, cycle.id),
    listTemplates(db),
    listSelfRequests(db, actor, id),
  ]);
  return (
    <CycleDetailView
      cycle={{
        id: cycle.id,
        name: cycle.name,
        status: cycle.status,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        snapshotDate: cycle.snapshotDate,
        questionCount: cycle.questionCount,
        stats: cycle.stats,
        allowedTransitions: cycle.allowedTransitions,
        scheduleKind: cycle.scheduleKind,
        hireDateSchedule: cycle.hireDateSchedule,
        defaultTemplateName:
          templates.find((t) => t.id === cycle.templateId)?.name ?? null,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          templateName: g.templateName,
          filter: g.filter,
          participantCount: g.participantCount,
          questionCount: g.questionCount,
        })),
        participants: cycle.participants.map((p) => ({
          id: p.id,
          displayName: p.displayName,
          snapManagerName: p.snapManagerName,
          snapDepartment: p.snapDepartment,
          snapJobTitle: p.snapJobTitle,
          withoutManager: p.withoutManager,
          removedAt: p.removedAt,
          templateGroupId: p.templateGroupId,
          dueDates: p.dueDates,
        })),
        transitions: cycle.transitions,
      }}
      actions={{
        transition: transitionCycleAction,
        launch: launchCycleAction,
        duplicate: duplicateCycleAction,
      }}
      selfReview={
        selfRequests.length
          ? {
              byParticipant: Object.fromEntries(
                selfRequests.map((r) => [
                  r.participantId,
                  { requestId: r.requestId, status: r.status },
                ]),
              ),
              canUnlock: actor.role === "hr",
              unlock: unlockAction,
            }
          : undefined
      }
    />
  );
}

export default function CyclePage(props: PageProps<"/[locale]/cycles/[id]">) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Detail {...props} />
      </Suspense>
    </main>
  );
}
