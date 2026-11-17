import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  type GoalStatus,
  participantGoalSnapshot,
  person,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { canSeeSensitiveIndicators } from "@/modules/insights/authz";
import { getReview, type Review } from "@/modules/review-core/answers";
import { ReviewError } from "@/modules/review-core/review-errors";

/** A goal of the person in the cycle's period, as the snapshot kept it. */
export type PeriodGoal = {
  id: string;
  title: string;
  status: GoalStatus;
  percentComplete: number;
  dueDate: string | null;
  /** In progress and due before the period ended (the KPIs' overdue). */
  overdue: boolean;
  /** The goal was deleted after the snapshot. */
  noLongerApplicable: boolean;
};

/** One submitted review of the participant, with who wrote it. */
export type AssessmentReview = {
  relationship: "self" | "manager";
  reviewerName: string | null;
  /** Submitted by someone who was not the manager of the snapshot. */
  reviewerMismatch: boolean;
  /** The questions and answers the actor may read (canRead per question). */
  review: Review;
};

export type ParticipantAssessment = {
  cycle: {
    id: string;
    name: string;
    periodStart: string;
    periodEnd: string;
  };
  participant: {
    id: string;
    personId: string;
    name: string;
    managerName: string | null;
    department: string | null;
    jobTitle: string | null;
    removed: boolean;
  };
  goals: PeriodGoal[];
  /** When the goals were captured (the legend's "as of"); null without goals. */
  goalsAsOf: Date | null;
  /** Self review first, then the managers'. */
  reviews: AssessmentReview[];
};

/**
 * What the import left of one participant's assessment: the answers of the
 * submitted self and manager reviews the actor may read (the visibility
 * rules, per question) and the goals of the period from the participant's
 * goal snapshot. People read anyone; a manager only their direct reports of
 * the snapshot (never themself); direction (aggregates only) and employees
 * are forbidden. `not_found` when the participant is not of that cycle.
 */
export async function participantAssessment(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  participantId: string,
): Promise<ParticipantAssessment> {
  if (!isUuid(cycleId) || !isUuid(participantId)) {
    throw new ReviewError("not_found");
  }
  const [cycle] = await db
    .select()
    .from(reviewCycle)
    .where(and(eq(reviewCycle.id, cycleId), isNull(reviewCycle.deletedAt)));
  if (!cycle) throw new ReviewError("not_found");
  const [participant] = await db
    .select()
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.id, participantId),
        eq(cycleParticipant.cycleId, cycle.id),
      ),
    );
  if (!participant) throw new ReviewError("not_found");
  const allowed =
    canSeeSensitiveIndicators(actor, {
      revieweePersonId: participant.revieweePersonId,
      snapManagerPersonId: participant.snapManagerPersonId,
    }) &&
    // A participant removed from the cycle is People's business only.
    (actor.role === "hr" || !participant.removedAt);
  if (!allowed) throw new ReviewError("forbidden");

  const goalRows = await db
    .select()
    .from(participantGoalSnapshot)
    .where(eq(participantGoalSnapshot.participantId, participant.id))
    .orderBy(
      sql`${participantGoalSnapshot.dueDate} asc nulls last`,
      asc(participantGoalSnapshot.title),
      asc(participantGoalSnapshot.id),
    );
  const goals = goalRows.map((g): PeriodGoal => ({
    id: g.id,
    title: g.title,
    status: g.status,
    percentComplete: g.percentComplete,
    dueDate: g.dueDate,
    overdue:
      g.status === "in_progress" &&
      g.dueDate !== null &&
      g.dueDate < cycle.periodEnd,
    noLongerApplicable: g.noLongerApplicable,
  }));
  const goalsAsOf = goalRows.reduce<Date | null>((latest, g) => {
    const at = g.refreshedAt ?? g.capturedAt;
    return latest === null || at > latest ? at : latest;
  }, null);

  const requests = await db
    .select({
      id: reviewRequest.id,
      relationship: reviewRequest.relationship,
      reviewerPersonId: reviewRequest.reviewerPersonId,
      mismatch: reviewRequest.reviewerMismatch,
    })
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.participantId, participant.id),
        inArray(reviewRequest.relationship, ["self", "manager"]),
        eq(reviewRequest.status, "submitted"),
        isNull(reviewRequest.deletedAt),
      ),
    )
    .orderBy(asc(reviewRequest.relationship), asc(reviewRequest.submittedAt));
  // The names of everybody who shows up: the reviewee, their manager, the authors.
  const peopleIds = [
    ...new Set([
      participant.revieweePersonId,
      ...(participant.snapManagerPersonId
        ? [participant.snapManagerPersonId]
        : []),
      ...requests.flatMap((r) =>
        r.reviewerPersonId ? [r.reviewerPersonId] : [],
      ),
    ]),
  ];
  const names = new Map(
    (
      await db
        .select({ id: person.id, name: person.displayName })
        .from(person)
        .where(inArray(person.id, peopleIds))
    ).map((p) => [p.id, p.name]),
  );
  const reviews: AssessmentReview[] = [];
  for (const r of requests) {
    const review = await getReview(db, actor, r.id);
    if (
      !review ||
      (r.relationship !== "self" && r.relationship !== "manager")
    ) {
      continue;
    }
    reviews.push({
      relationship: r.relationship,
      reviewerName: r.reviewerPersonId
        ? (names.get(r.reviewerPersonId) ?? null)
        : null,
      reviewerMismatch: r.mismatch,
      review,
    });
  }
  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
    },
    participant: {
      id: participant.id,
      personId: participant.revieweePersonId,
      name: names.get(participant.revieweePersonId) ?? "",
      managerName: participant.snapManagerPersonId
        ? (names.get(participant.snapManagerPersonId) ?? null)
        : null,
      department: participant.snapDepartment,
      jobTitle: participant.snapJobTitle,
      removed: participant.removedAt !== null,
    },
    goals,
    goalsAsOf,
    reviews,
  };
}
