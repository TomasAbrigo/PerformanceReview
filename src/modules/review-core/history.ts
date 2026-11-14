import { aliasedTable, and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { getReview, type Review } from "./answers";
import { countsTowardOverall, overallRatingQuestion } from "./goal-snapshot";
import { isCurrentManager } from "./manager";
import { ReviewError } from "./review-errors";
import type { CycleStatus } from "./status";

/** A rating as the history shows it: the scale value, its label, 0-1. */
export type HistoryRating = {
  value: number;
  label: LocalizedText;
  normalized: number;
};

export type HistoryItem = {
  participantId: string;
  cycleId: string;
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  cycleStatus: CycleStatus;
  /** Manager at the cycle's snapshot (not necessarily the current one). */
  managerPersonId: string | null;
  managerName: string | null;
  /** Job title and department at the cycle's snapshot. */
  jobTitle: string | null;
  department: string | null;
  sharedAt: Date | null;
  acknowledgedAt: Date | null;
  rating: HistoryRating | null;
  /** The reviews as far as the actor may read them (canRead), submitted only. */
  self: Review | null;
  manager: Review | null;
  /** Both reviews are readable: the comparison page is available. */
  canCompare: boolean;
};

/**
 * The current rating, read from the manager review AS THE ACTOR MAY READ IT
 * (so it is never more than canRead allows: an unshared review gives the
 * current manager nothing, and the employee only gets a rating on a question
 * visible to them).
 *
 * TODO(#16): replace with `currentRatingFor(participantId)` (calibration's
 * v_current_rating: override > calibrated > manager), keeping the gate on the
 * manager review being readable. Until then it is the answer to the question
 * marked overall_rating (#13's role); a template without one has no rating
 * here (a guess among the visible questions could show the wrong one).
 */
function ratingOf(manager: Review | null): HistoryRating | null {
  if (!manager) return null;
  const overall = overallRatingQuestion(
    manager.questions.filter((q) => q.kind === "rating"),
  );
  if (!overall || !countsTowardOverall(overall)) return null;
  const value = manager.answers[overall.id];
  const option =
    value === null || value === undefined
      ? undefined
      : overall.scale?.options.find((o) => o.value === Number(value));
  return option
    ? {
        value: option.value,
        label: option.label,
        normalized: option.normalized,
      }
    : null;
}

/**
 * A person's history of finalized (closed) or shared cycles, newest first:
 * snapshot manager, job title and department of that moment, current
 * rating, and the reviews the actor may read.
 *
 * Who lists what: the person themselves only the cycles whose manager review
 * was shared with them; HR everything; the person's current manager every
 * cycle (even those they did not manage, to know the trajectory); a former
 * snapshot manager only the cycles they managed. Anyone else: forbidden.
 * What they read inside a listed cycle (answers, rating) is whatever canRead
 * allows them, so a current manager reads a cycle's reviews only once they
 * were shared with the employee.
 */
export async function reviewHistory(
  db: DbOrTx,
  actor: ActorContext,
  personId: string,
): Promise<HistoryItem[]> {
  if (!isUuid(personId)) throw new ReviewError("not_found");
  const [exists] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.id, personId));
  if (!exists) throw new ReviewError("not_found");

  const snapManager = aliasedTable(person, "snap_manager");
  const rows = await db
    .select({
      participant: cycleParticipant,
      cycle: reviewCycle,
      managerName: snapManager.displayName,
      managerRequest: reviewRequest,
    })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .leftJoin(
      snapManager,
      eq(snapManager.id, cycleParticipant.snapManagerPersonId),
    )
    .leftJoin(
      reviewRequest,
      and(
        eq(reviewRequest.participantId, cycleParticipant.id),
        eq(reviewRequest.relationship, "manager"),
        isNull(reviewRequest.deletedAt),
      ),
    )
    .where(
      and(
        eq(cycleParticipant.revieweePersonId, personId),
        isNull(cycleParticipant.removedAt),
        isNull(reviewCycle.deletedAt),
        ne(reviewCycle.status, "draft"),
      ),
    )
    .orderBy(desc(reviewCycle.periodEnd), desc(reviewCycle.periodStart));

  const isHr = actor.role === "hr";
  const isSelf = !isHr && actor.personId === personId;
  const currentManager =
    !isHr && !isSelf && (await isCurrentManager(db, actor, personId));
  const managedByActor = (r: (typeof rows)[number]) =>
    actor.personId !== null &&
    actor.personId === r.participant.snapManagerPersonId;
  if (!isHr && !isSelf && !currentManager && !rows.some(managedByActor)) {
    throw new ReviewError("forbidden");
  }

  const mine = rows.filter((r) => {
    const sharedAt = r.managerRequest?.sharedAt ?? null;
    const finalized = r.cycle.status === "closed" || sharedAt !== null;
    if (isHr || currentManager || managedByActor(r)) return finalized;
    // The employee: only what was shared with them.
    return (
      isSelf && sharedAt !== null && r.managerRequest?.status === "submitted"
    );
  });
  if (mine.length === 0) return [];

  // One query for the self requests of every listed cycle.
  const selfRequests = await db
    .select({
      id: reviewRequest.id,
      participantId: reviewRequest.participantId,
    })
    .from(reviewRequest)
    .where(
      and(
        inArray(
          reviewRequest.participantId,
          mine.map((r) => r.participant.id),
        ),
        eq(reviewRequest.relationship, "self"),
        isNull(reviewRequest.deletedAt),
      ),
    );
  const selfOf = new Map(selfRequests.map((r) => [r.participantId, r.id]));

  const readSubmitted = async (requestId: string | undefined) => {
    if (!requestId) return null;
    const review = await getReview(db, actor, requestId);
    return review?.request.status === "submitted" ? review : null;
  };

  return Promise.all(
    mine.map(async ({ participant, cycle, managerName, managerRequest }) => {
      const [self, manager] = await Promise.all([
        readSubmitted(selfOf.get(participant.id)),
        readSubmitted(managerRequest?.id),
      ]);
      return {
        participantId: participant.id,
        cycleId: cycle.id,
        cycleName: cycle.name,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        cycleStatus: cycle.status,
        managerPersonId: participant.snapManagerPersonId,
        managerName,
        jobTitle: participant.snapJobTitle,
        department: participant.snapDepartment,
        sharedAt: managerRequest?.sharedAt ?? null,
        acknowledgedAt: participant.acknowledgedAt,
        rating: ratingOf(manager),
        self,
        manager,
        canCompare: self !== null && manager !== null,
      };
    }),
  );
}
