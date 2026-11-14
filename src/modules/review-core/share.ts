import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  reviewAudit,
  reviewCycle,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { notifyReviewsShared } from "@/modules/notifications/events";
import type { ActorContext } from "@/modules/actor/types";
import { loadRequest } from "./requests";
import { ReviewError } from "./review-errors";
import { canShare, shareableNow } from "./visibility";

/**
 * Shares a submitted manager review with the reviewee (sets shared_at,
 * audited). Who: canShare (HR, the reviewer, the snapshot manager; active
 * participant). When: shareableNow (the `sharing` phase, after calibration
 * is published when calibration is on). Sharing twice is a no-op; entering
 * the `sharing` phase does not share anything by itself.
 */
export async function shareReview(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<ReviewRequest> {
  return db.transaction(async (tx) => {
    const { request, participant, cycle, visibility } = await loadRequest(
      tx,
      actor,
      requestId,
      { forUpdate: true },
    );
    if (
      !canShare(actor, {
        request,
        participant,
        snapManagerReplaced: visibility.snapManagerReplaced,
      })
    ) {
      throw new ReviewError("forbidden");
    }
    if (request.status !== "submitted") throw new ReviewError("not_submitted");
    if (request.sharedAt) return request;
    if (!shareableNow(cycle)) throw new ReviewError("not_shareable");
    const [updated] = await tx
      .update(reviewRequest)
      .set({ sharedAt: new Date(), sharedBy: actor.personId })
      .where(eq(reviewRequest.id, requestId))
      .returning();
    await tx.insert(reviewAudit).values({
      requestId,
      action: "shared",
      actorPersonId: actor.personId,
    });
    // shared_at tells a second share (after an unshare) from the first.
    await notifyReviewsShared(tx, {
      cycleId: cycle.id,
      items: [{ requestId, recipientPersonId: participant.revieweePersonId }],
      senderPersonId: actor.personId,
      dedupeSuffix: updated.sharedAt?.toISOString(),
    });
    return updated;
  });
}

/**
 * HR shares every submitted, unshared manager review of the active
 * participants of a cycle (same phase rule as shareReview).
 */
export async function shareAll(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<number> {
  if (actor.role !== "hr") throw new ReviewError("forbidden");
  if (!isUuid(cycleId)) throw new ReviewError("not_found");
  return db.transaction(async (tx) => {
    const [cycle] = await tx
      .select()
      .from(reviewCycle)
      .where(and(eq(reviewCycle.id, cycleId), isNull(reviewCycle.deletedAt)))
      .for("update");
    if (!cycle) throw new ReviewError("not_found");
    if (!shareableNow(cycle)) throw new ReviewError("not_shareable");
    const active = tx
      .select({ id: cycleParticipant.id })
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycleId),
          isNull(cycleParticipant.removedAt),
        ),
      );
    const sharedAt = new Date();
    const shared = await tx
      .update(reviewRequest)
      .set({ sharedAt, sharedBy: actor.personId })
      .where(
        and(
          eq(reviewRequest.cycleId, cycleId),
          eq(reviewRequest.relationship, "manager"),
          eq(reviewRequest.status, "submitted"),
          isNull(reviewRequest.sharedAt),
          isNull(reviewRequest.deletedAt),
          inArray(reviewRequest.participantId, active),
        ),
      )
      .returning({
        id: reviewRequest.id,
        participantId: reviewRequest.participantId,
      });
    if (shared.length) {
      const reviewees = await tx
        .select({
          id: cycleParticipant.id,
          personId: cycleParticipant.revieweePersonId,
        })
        .from(cycleParticipant)
        .where(
          inArray(
            cycleParticipant.id,
            shared.map((r) => r.participantId),
          ),
        );
      const personOf = new Map(reviewees.map((p) => [p.id, p.personId]));
      await notifyReviewsShared(tx, {
        cycleId,
        items: shared.map((r) => ({
          requestId: r.id,
          recipientPersonId: personOf.get(r.participantId)!,
        })),
        senderPersonId: actor.personId,
        dedupeSuffix: sharedAt.toISOString(),
      });
      await tx.insert(reviewAudit).values(
        shared.map((r) => ({
          requestId: r.id,
          action: "shared" as const,
          actorPersonId: actor.personId,
          note: "bulk",
        })),
      );
    }
    return shared.length;
  });
}

/** HR hides a shared manager review from the reviewee again (audited). */
export async function unshare(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  note: string | null = null,
): Promise<ReviewRequest> {
  if (actor.role !== "hr") throw new ReviewError("forbidden");
  return db.transaction(async (tx) => {
    const { request } = await loadRequest(tx, actor, requestId, {
      forUpdate: true,
    });
    if (!request.sharedAt) return request;
    const [updated] = await tx
      .update(reviewRequest)
      .set({ sharedAt: null, sharedBy: null })
      .where(eq(reviewRequest.id, requestId))
      .returning();
    await tx.insert(reviewAudit).values({
      requestId,
      action: "unshared",
      actorPersonId: actor.personId,
      note: note?.trim() || null,
    });
    return updated;
  });
}
