import { aliasedTable, and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  type ReviewCycle,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { getReview, type Review } from "./answers";
import { currentRatingFor, finalScale } from "./calibration";
import { overallRatingQuestion } from "./goal-snapshot";
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
 * The participant's current rating (calibration's `currentRatingFor`:
 * override > calibrated > manager), labelled in the cycle's final scale, for
 * an actor who may see it: HR always; anyone else only if they can read the
 * manager review (so an unshared review gives the current manager nothing)
 * AND the calibration, when the cycle has one, is published (a pre-publish
 * calibrated rating is not shown to managers nor employees).
 */
async function ratingOf(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  cycle: Pick<ReviewCycle, "id" | "components" | "calibrationPublishedAt">,
  manager: Review | null,
): Promise<HistoryRating | null> {
  if (actor.role !== "hr") {
    const published =
      !cycle.components.calibration || cycle.calibrationPublishedAt !== null;
    if (!manager || !published) return null;
  }
  const current = await currentRatingFor(db, participantId);
  if (!current || current.normalized === null) return null;
  const option = (await finalScale(db, cycle.id)).find(
    (o) => o.value === current.optionValue,
  );
  const fallback = current.optionLabel ?? String(current.optionValue);
  return {
    value: current.optionValue,
    label: option?.label ?? { es: fallback, en: fallback },
    normalized: current.normalized,
  };
}

/**
 * The manager review as the reviewee sees it: without the overall rating
 * question (they only see the final rating, never the original: PRD 66).
 */
function withoutOverall(review: Review): Review {
  const overall = overallRatingQuestion(review.questions);
  if (!overall) return review;
  return {
    ...review,
    questions: review.questions.filter((q) => q.id !== overall.id),
    answers: Object.fromEntries(
      Object.entries(review.answers).filter(([id]) => id !== overall.id),
    ),
  };
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
      const [self, readable] = await Promise.all([
        readSubmitted(selfOf.get(participant.id)),
        readSubmitted(managerRequest?.id),
      ]);
      const rating = await ratingOf(db, actor, participant.id, cycle, readable);
      // The employee reads the manager review without the original rating.
      const manager = readable && isSelf ? withoutOverall(readable) : readable;
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
        rating,
        self,
        manager,
        canCompare: self !== null && manager !== null,
      };
    }),
  );
}
