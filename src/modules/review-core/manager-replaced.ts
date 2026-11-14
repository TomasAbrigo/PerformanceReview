import { and, eq, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { type CycleParticipant, reviewRequest } from "@/db/schema";

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
  const [row] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.participantId, participant.id),
        eq(reviewRequest.relationship, "manager"),
        eq(reviewRequest.additional, false),
        eq(reviewRequest.assignedByHr, true),
        ne(reviewRequest.status, "superseded"),
        isNull(reviewRequest.deletedAt),
        ne(reviewRequest.reviewerPersonId, participant.snapManagerPersonId),
      ),
    )
    .limit(1);
  return !!row;
}
