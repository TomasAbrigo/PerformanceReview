import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  type CycleParticipant,
  cycleParticipant,
  person,
  type ReviewCycle,
  reviewCycle,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { isSkipLevel } from "./manager";
import { ReviewError } from "./review-errors";

/**
 * A participant with the pieces the #15 features (compare, follow-up notes,
 * acknowledgement) decide on: their cycle and their self and manager
 * requests. Only ids/statuses: reading answers still goes through
 * getReview/canRead.
 */
export type ParticipantScope = {
  participant: CycleParticipant;
  cycle: ReviewCycle;
  revieweeName: string;
  selfRequest: ReviewRequest | null;
  managerRequest: ReviewRequest | null;
};

/** The participant's scope; throws not_found (also for a deleted cycle). */
export async function loadParticipantScope(
  db: DbOrTx,
  participantId: string,
): Promise<ParticipantScope> {
  if (!isUuid(participantId)) throw new ReviewError("not_found");
  const [row] = await db
    .select({
      participant: cycleParticipant,
      cycle: reviewCycle,
      revieweeName: person.displayName,
    })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .where(eq(cycleParticipant.id, participantId));
  if (!row || row.cycle.deletedAt) throw new ReviewError("not_found");
  const requests = await db
    .select()
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.participantId, participantId),
        isNull(reviewRequest.deletedAt),
      ),
    );
  return {
    ...row,
    selfRequest: requests.find((r) => r.relationship === "self") ?? null,
    managerRequest: requests.find((r) => r.relationship === "manager") ?? null,
  };
}

/** The actor is the reviewee (acting as that person). */
export const isRevieweeOf = (actor: ActorContext, s: ParticipantScope) =>
  actor.personId !== null && actor.personId === s.participant.revieweePersonId;

/** The actor is the participant's snapshot manager or their manager reviewer. */
export const isManagerSideOf = (actor: ActorContext, s: ParticipantScope) =>
  actor.personId !== null &&
  (actor.personId === s.participant.snapManagerPersonId ||
    actor.personId === s.managerRequest?.reviewerPersonId);

/** The reviewee may read what their manager shared once it is shared. */
export const isShared = (s: ParticipantScope) =>
  s.managerRequest?.status === "submitted" && !!s.managerRequest.sharedAt;

/** Skip-level manager as of the participant's snapshot. */
export const isSkipLevelOf = (
  db: DbOrTx,
  actor: ActorContext,
  s: ParticipantScope,
) => isSkipLevel(db, actor, s.participant);
