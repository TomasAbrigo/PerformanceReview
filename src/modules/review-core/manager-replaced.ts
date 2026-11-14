import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  type CycleParticipant,
  cycleParticipant,
  reviewRequest,
} from "@/db/schema";

/**
 * Whether HR replaced the participant's snapshot manager as the reviewer of
 * their (primary) manager review (#17 assignAlternateAssessor, mode replace):
 * the request goes to someone else on purpose. The replaced manager no longer
 * reads or shares that participant's reviews, sees them in their team or
 * nudges their reviewers; an additional assessor, or a reassignment back to
 * them, changes nothing.
 */
export async function isManagerReplaced(
  db: DbOrTx,
  participant: Pick<CycleParticipant, "id" | "snapManagerPersonId">,
): Promise<boolean> {
  if (!participant.snapManagerPersonId) return false;
  return (await managerReplacedAmong(db, [participant.id])).has(participant.id);
}

/**
 * isManagerReplaced for many participants at once (one query): the ids of
 * those whose snapshot manager was replaced as reviewer.
 */
export async function managerReplacedAmong(
  db: DbOrTx,
  participantIds: string[],
): Promise<Set<string>> {
  if (participantIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ id: reviewRequest.participantId })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .where(
      and(
        inArray(reviewRequest.participantId, participantIds),
        isNotNull(cycleParticipant.snapManagerPersonId),
        eq(reviewRequest.relationship, "manager"),
        eq(reviewRequest.additional, false),
        eq(reviewRequest.assignedByHr, true),
        ne(reviewRequest.status, "superseded"),
        isNull(reviewRequest.deletedAt),
        ne(
          reviewRequest.reviewerPersonId,
          cycleParticipant.snapManagerPersonId,
        ),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
