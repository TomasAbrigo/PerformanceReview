import { aliasedTable, and, desc, eq, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  questionRevision,
  answer,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { managerAsOf } from "@/modules/org-history/queries";
import { getReview, type Review } from "./answers";
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
 * The person's current rating for a participant.
 *
 * TODO(#16): replace with `currentRatingFor(participantId)` (calibration's
 * v_current_rating: override > calibrated > manager). Until then it is the
 * manager's overall rating: the last rating question of the manager review
 * of a submitted review; the employee only gets it when that question is
 * visible to them (`forReviewee`).
 */
async function fallbackCurrentRating(
  db: DbOrTx,
  requestId: string,
  cycleId: string,
  forReviewee: boolean,
): Promise<HistoryRating | null> {
  const revisions = await db
    .select()
    .from(questionRevision)
    .where(eq(questionRevision.cycleId, cycleId))
    .orderBy(desc(questionRevision.sort));
  const overall = revisions.find(
    (q) => q.kind === "rating" && q.appliesTo.includes("manager"),
  );
  if (!overall || (forReviewee && !overall.visibleToReviewee)) return null;
  const [row] = await db
    .select({ value: answer.optionValue, normalized: answer.normalized })
    .from(answer)
    .where(
      and(
        eq(answer.requestId, requestId),
        eq(answer.questionRevisionId, overall.id),
      ),
    );
  if (row?.value == null || row.normalized == null) return null;
  const option = overall.scale?.options.find((o) => o.value === row.value);
  return option
    ? { value: row.value, label: option.label, normalized: row.normalized }
    : null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A person's history of finalized (closed) or shared cycles, newest first:
 * snapshot manager, job title and department of that moment, current
 * rating, and the reviews the actor may read.
 *
 * Who reads what: the person themselves only the cycles whose manager
 * review was shared with them (and only the questions visible to them); HR
 * everything; the person's current manager every cycle (even those they did
 * not manage, to know the trajectory), reading answers as canRead allows;
 * a former snapshot manager only the cycles they managed. Anyone else:
 * forbidden.
 */
export async function reviewHistory(
  db: DbOrTx,
  actor: ActorContext,
  personId: string,
  { today = new Date() }: { today?: Date } = {},
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
  const isCurrentManager =
    !isHr &&
    actor.personId !== null &&
    (await managerAsOf(db, personId, isoDay(today))) === actor.personId;
  const managedByActor = (r: (typeof rows)[number]) =>
    actor.personId !== null &&
    actor.personId === r.participant.snapManagerPersonId;
  if (!isHr && !isSelf && !isCurrentManager && !rows.some(managedByActor)) {
    throw new ReviewError("forbidden");
  }

  const mine = rows.filter((r) => {
    const sharedAt = r.managerRequest?.sharedAt ?? null;
    const finalized = r.cycle.status === "closed" || sharedAt !== null;
    if (isHr || isCurrentManager || managedByActor(r)) return finalized;
    // The employee: only what was shared with them.
    return (
      isSelf && sharedAt !== null && r.managerRequest?.status === "submitted"
    );
  });

  const readSubmitted = async (requestId: string | null) => {
    if (!requestId) return null;
    const review = await getReview(db, actor, requestId);
    return review?.request.status === "submitted" ? review : null;
  };

  return Promise.all(
    mine.map(async ({ participant, cycle, managerName, managerRequest }) => {
      const [selfRequest] = await db
        .select({ id: reviewRequest.id })
        .from(reviewRequest)
        .where(
          and(
            eq(reviewRequest.participantId, participant.id),
            eq(reviewRequest.relationship, "self"),
            isNull(reviewRequest.deletedAt),
          ),
        );
      const [self, manager] = await Promise.all([
        readSubmitted(selfRequest?.id ?? null),
        readSubmitted(managerRequest?.id ?? null),
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
        rating:
          managerRequest?.status === "submitted"
            ? await fallbackCurrentRating(
                db,
                managerRequest.id,
                cycle.id,
                isSelf,
              )
            : null,
        self,
        manager,
        canCompare: self !== null && manager !== null,
      };
    }),
  );
}
