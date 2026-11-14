import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { cycleParticipant, reviewCycle, reviewRequest } from "@/db/schema";
import { DomainError } from "@/lib/domain-error";
import type { ActorContext } from "@/modules/actor/types";
import {
  type AckStatus,
  ackStatus,
  acknowledgeDeadline,
  DEFAULT_ACK_WINDOW_DAYS,
} from "./acknowledge-window";
import {
  isManagerSideOf,
  isRevieweeOf,
  isShared,
  loadParticipantScope,
  type ParticipantScope,
} from "./participant-scope";

export type AckErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "not_shared"
  | "already_acknowledged"
  | "window_closed";

/** Errors of acknowledging a shared review. */
export class AckError extends DomainError<AckErrorCode> {}

export const ACK_NOTE_MAX_LENGTH = 2000;

export type AckOptions = {
  /** Override "now" (tests). */
  now?: Date;
  /** Days after sharing when the cycle has no acknowledge due date. */
  windowDays?: number;
};

export type AckState = {
  participantId: string;
  cycleId: string;
  cycleName: string;
  status: AckStatus;
  sharedAt: Date | null;
  acknowledgedAt: Date | null;
  note: string | null;
  /** Last instant to acknowledge; null until the review is shared. */
  deadline: Date | null;
};

function stateOf(
  scope: ParticipantScope,
  { now = new Date(), windowDays = DEFAULT_ACK_WINDOW_DAYS }: AckOptions,
): AckState {
  const { participant, cycle, managerRequest } = scope;
  const sharedAt = isShared(scope) ? managerRequest!.sharedAt : null;
  const deadline = sharedAt
    ? acknowledgeDeadline({
        sharedAt,
        dueDate: cycle.dueDates.acknowledge,
        windowDays,
      })
    : null;
  return {
    participantId: participant.id,
    cycleId: cycle.id,
    cycleName: cycle.name,
    status: ackStatus({
      sharedAt,
      acknowledgedAt: participant.acknowledgedAt,
      deadline,
      now,
    }),
    sharedAt,
    acknowledgedAt: participant.acknowledgedAt,
    note: participant.acknowledgementNote,
    deadline,
  };
}

/**
 * The acknowledgement state of a participant's shared review: for the
 * employee, their manager (snapshot manager or reviewer) and HR.
 */
export async function getAcknowledgement(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  options: AckOptions = {},
): Promise<AckState> {
  const scope = await loadParticipantScope(db, participantId);
  if (
    actor.role !== "hr" &&
    !isRevieweeOf(actor, scope) &&
    !isManagerSideOf(actor, scope)
  ) {
    throw new AckError("forbidden");
  }
  return stateOf(scope, options);
}

/**
 * The employee acknowledges their shared manager review, with an optional
 * note. Only the reviewee (not HR on their behalf), only once the review is
 * shared, only once and within the window: the cycle's acknowledge due date
 * or, without one, 7 days after sharing. Immutable afterwards (the row is
 * locked and only updated while acknowledged_at is still null).
 */
export async function acknowledge(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  note: string | null = null,
  options: AckOptions = {},
): Promise<AckState> {
  const first = await loadParticipantScope(db, participantId);
  if (!isRevieweeOf(actor, first)) throw new AckError("forbidden");
  const text = note?.trim() || null;
  if (text !== null && text.length > ACK_NOTE_MAX_LENGTH) {
    throw new AckError("validation", [{ path: "note", message: "too_long" }]);
  }
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    // Serialises concurrent attempts: the loser sees acknowledged_at set.
    await tx
      .select({ id: cycleParticipant.id })
      .from(cycleParticipant)
      .where(eq(cycleParticipant.id, participantId))
      .for("update");
    const scope = await loadParticipantScope(tx, participantId);
    if (scope.participant.acknowledgedAt) {
      throw new AckError("already_acknowledged");
    }
    const state = stateOf(scope, { ...options, now });
    if (state.status === "not_shared") throw new AckError("not_shared");
    if (state.status === "expired") throw new AckError("window_closed");
    const [updated] = await tx
      .update(cycleParticipant)
      .set({ acknowledgedAt: now, acknowledgementNote: text })
      .where(
        and(
          eq(cycleParticipant.id, participantId),
          isNull(cycleParticipant.acknowledgedAt),
        ),
      )
      .returning();
    if (!updated) throw new AckError("already_acknowledged");
    return stateOf({ ...scope, participant: updated }, { ...options, now });
  });
}

export type AckTask = {
  participantId: string;
  cycleId: string;
  cycleName: string;
  sharedAt: Date;
  deadline: Date;
};

/**
 * The actor's shared manager reviews still to acknowledge (the "Acusar
 * recibo" tasks of /me): shared, not acknowledged and with the window open.
 */
export async function listMyAcknowledgements(
  db: DbOrTx,
  actor: ActorContext,
  { now = new Date(), windowDays = DEFAULT_ACK_WINDOW_DAYS }: AckOptions = {},
): Promise<AckTask[]> {
  if (!actor.personId) return [];
  const rows = await db
    .select({
      participantId: cycleParticipant.id,
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      dueDates: reviewCycle.dueDates,
      sharedAt: reviewRequest.sharedAt,
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .where(
      and(
        eq(cycleParticipant.revieweePersonId, actor.personId),
        eq(reviewRequest.relationship, "manager"),
        eq(reviewRequest.status, "submitted"),
        isNotNull(reviewRequest.sharedAt),
        isNull(reviewRequest.deletedAt),
        isNull(cycleParticipant.acknowledgedAt),
        isNull(cycleParticipant.removedAt),
        isNull(reviewCycle.deletedAt),
      ),
    )
    .orderBy(asc(reviewRequest.sharedAt));
  return rows
    .map((r) => ({
      participantId: r.participantId,
      cycleId: r.cycleId,
      cycleName: r.cycleName,
      sharedAt: r.sharedAt!,
      deadline: acknowledgeDeadline({
        sharedAt: r.sharedAt!,
        dueDate: r.dueDates.acknowledge,
        windowDays,
      }),
    }))
    .filter((task) => now.getTime() <= task.deadline.getTime());
}
