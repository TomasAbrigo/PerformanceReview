import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { cycleParticipant } from "@/db/schema";
import { DomainError } from "@/lib/domain-error";
import type { ActorContext } from "@/modules/actor/types";
import {
  type AckStatus,
  ackStatus,
  acknowledgeDeadline,
  DEFAULT_ACK_WINDOW_DAYS,
} from "./acknowledge-window";
import { ACK_NOTE_MAX_LENGTH } from "./limits";
import {
  isActive,
  isManagerSideOf,
  isRevieweeOf,
  isShared,
  loadParticipantScope,
  type ParticipantRef,
  type ParticipantScope,
  scopeOf,
} from "./participant-scope";

export { ACK_NOTE_MAX_LENGTH };

export type AckErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "not_shared"
  | "already_acknowledged"
  | "window_closed";

/** Errors of acknowledging a shared review. */
export class AckError extends DomainError<AckErrorCode> {}

export type AckOptions = {
  /** Override "now" (tests). */
  now?: Date;
  /** Days after sharing the employee has at least. */
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
        // The participant's own date (#21), else the cycle's.
        dueDate:
          participant.dueDates?.acknowledge ?? cycle.dueDates.acknowledge,
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

/** Who may see the acknowledgement state: the employee, their manager side, HR. */
export const mayViewAcknowledgement = (
  actor: ActorContext,
  scope: ParticipantScope,
) =>
  actor.role === "hr" ||
  (isActive(scope) &&
    (isRevieweeOf(actor, scope) || isManagerSideOf(actor, scope)));

/**
 * The acknowledgement state of a participant's shared review: for the
 * employee, their manager (snapshot manager or reviewer) and HR. Takes the
 * participant's scope when the caller already loaded it.
 */
export async function getAcknowledgement(
  db: DbOrTx,
  actor: ActorContext,
  participant: ParticipantRef,
  options: AckOptions = {},
): Promise<AckState> {
  const scope = await scopeOf(db, participant);
  if (!mayViewAcknowledgement(actor, scope)) throw new AckError("forbidden");
  return stateOf(scope, options);
}

/**
 * The employee acknowledges their shared manager review, with an optional
 * note. Only the reviewee (not HR on their behalf), only once the review is
 * shared, only once and within the window: until the later of the
 * acknowledge due date and 7 days after sharing. Immutable afterwards (the
 * row is locked and only updated while acknowledged_at is still null). The
 * state (not shared, window closed) is checked before the note is validated.
 */
export async function acknowledge(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  note: string | null = null,
  options: AckOptions = {},
): Promise<AckState> {
  const first = await loadParticipantScope(db, participantId);
  if (!isRevieweeOf(actor, first) || !isActive(first)) {
    throw new AckError("forbidden");
  }
  const text = note?.trim() || null;
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
    if (text !== null && text.length > ACK_NOTE_MAX_LENGTH) {
      throw new AckError("validation", [{ path: "note", message: "too_long" }]);
    }
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
