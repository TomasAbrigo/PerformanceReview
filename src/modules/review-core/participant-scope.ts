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
import { isCurrentManager, isSkipLevel } from "./manager";
import { isManagerReplaced } from "./manager-replaced";
import { ReviewError } from "./review-errors";
import { isActiveParticipant } from "./visibility";

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
  /** The primary manager request (not superseded, not an additional one). */
  managerRequest: ReviewRequest | null;
  /** HR replaced the snapshot manager as its reviewer (#17): no manager-side access. */
  snapManagerReplaced: boolean;
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
  // A participant may have several manager requests (#17): the primary one
  // is the current manager review; superseded ones are history.
  const managerRequests = requests.filter(
    (r) => r.relationship === "manager" && r.status !== "superseded",
  );
  return {
    ...row,
    selfRequest: requests.find((r) => r.relationship === "self") ?? null,
    managerRequest:
      managerRequests.find((r) => !r.additional) ?? managerRequests[0] ?? null,
    snapManagerReplaced: await isManagerReplaced(db, row.participant),
  };
}

/** A participant id, or their scope when the caller already loaded it. */
export type ParticipantRef = string | ParticipantScope;

export const scopeOf = (
  db: DbOrTx,
  ref: ParticipantRef,
): Promise<ParticipantScope> =>
  typeof ref === "string"
    ? loadParticipantScope(db, ref)
    : Promise.resolve(ref);

/** Both the self assessment and the manager review are submitted. */
export const bothSubmitted = (s: ParticipantScope) =>
  s.selfRequest?.status === "submitted" &&
  s.managerRequest?.status === "submitted";

/** The participant is still in the cycle (removed ones are for HR only). */
export const isActive = (s: ParticipantScope) =>
  isActiveParticipant(s.participant);

/** The actor is the reviewee (acting as that person). */
export const isRevieweeOf = (actor: ActorContext, s: ParticipantScope) =>
  actor.personId !== null && actor.personId === s.participant.revieweePersonId;

/**
 * The actor is the participant's snapshot manager (unless HR replaced them as
 * reviewer, #17) or the reviewer of their manager review.
 */
export const isManagerSideOf = (actor: ActorContext, s: ParticipantScope) =>
  actor.personId !== null &&
  ((actor.personId === s.participant.snapManagerPersonId &&
    !s.snapManagerReplaced) ||
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

/**
 * The reviewee's manager today (see isCurrentManager). The snapshot manager is
 * decided by manager-side access instead (a replaced one gets nothing back
 * for being the current manager too).
 */
export const isCurrentManagerOfScope = async (
  db: DbOrTx,
  actor: ActorContext,
  s: ParticipantScope,
) =>
  actor.personId !== s.participant.snapManagerPersonId &&
  (await isCurrentManager(db, actor, s.participant.revieweePersonId));
