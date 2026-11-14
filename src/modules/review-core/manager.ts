import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import {
  type CycleParticipant,
  type ReviewCycle,
  cycleParticipant,
  person,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  NotificationError,
  type NotificationErrorCode,
} from "@/modules/notifications/errors";
import { remind } from "@/modules/notifications/reminders";
import { jobAsOf, managerAsOf } from "@/modules/org-history/queries";
import type { RequestStatus } from "./request-status";
import { ReviewError, type ReviewErrorCode } from "./review-errors";
import type { CycleStatus } from "./status";

/**
 * Whether the actor is the participant's skip-level manager: the manager of
 * their snapshot manager, as of the participant's snapshot date.
 */
export async function isSkipLevel(
  db: DbOrTx,
  actor: ActorContext,
  participant: Pick<CycleParticipant, "snapManagerPersonId" | "snapshotAsOf">,
): Promise<boolean> {
  if (!actor.personId || !participant.snapManagerPersonId) return false;
  const job = await jobAsOf(
    db,
    participant.snapManagerPersonId,
    participant.snapshotAsOf,
  );
  return job?.managerPersonId === actor.personId;
}

/**
 * Whether the actor is the person's manager today (as of `today`, the
 * org-history job row valid now): the manager who follows their trajectory,
 * including cycles in which someone else managed them.
 */
export async function isCurrentManager(
  db: DbOrTx,
  actor: ActorContext,
  personId: string,
  today: Date = new Date(),
): Promise<boolean> {
  if (!actor.personId) return false;
  return (
    (await managerAsOf(db, personId, today.toISOString().slice(0, 10))) ===
    actor.personId
  );
}

/**
 * Id of the manager request of a participant, when the actor may open it
 * (its reviewer, the snapshot manager or HR).
 */
export async function findManagerRequestId(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
): Promise<string | null> {
  if (!isUuid(participantId)) return null;
  const [row] = await db
    .select({
      id: reviewRequest.id,
      reviewer: reviewRequest.reviewerPersonId,
      manager: cycleParticipant.snapManagerPersonId,
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .where(
      and(
        eq(reviewRequest.participantId, participantId),
        eq(reviewRequest.relationship, "manager"),
        isNull(reviewRequest.deletedAt),
      ),
    );
  if (!row) return null;
  const allowed =
    actor.role === "hr" ||
    (actor.personId !== null &&
      (actor.personId === row.reviewer || actor.personId === row.manager));
  return allowed ? row.id : null;
}

export type TeamRow = {
  cycleId: string;
  cycleName: string;
  cycleStatus: CycleStatus;
  participantId: string;
  revieweePersonId: string;
  revieweeName: string;
  selfRequestId: string | null;
  selfStatus: RequestStatus | null;
  managerRequestId: string | null;
  managerStatus: RequestStatus | null;
  sharedAt: Date | null;
};

/**
 * The actor's direct reports (as of each cycle's snapshot) in active cycles,
 * with the status of their self and manager reviews.
 */
export async function listTeam(
  db: DbOrTx,
  actor: ActorContext,
): Promise<TeamRow[]> {
  if (!actor.personId) return [];
  const self = alias(reviewRequest, "self_request");
  const manager = alias(reviewRequest, "manager_request");
  return db
    .select({
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      cycleStatus: reviewCycle.status,
      participantId: cycleParticipant.id,
      revieweePersonId: cycleParticipant.revieweePersonId,
      revieweeName: person.displayName,
      selfRequestId: self.id,
      selfStatus: self.status,
      managerRequestId: manager.id,
      managerStatus: manager.status,
      sharedAt: manager.sharedAt,
    })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .leftJoin(
      self,
      and(
        eq(self.participantId, cycleParticipant.id),
        eq(self.relationship, "self"),
        isNull(self.deletedAt),
      ),
    )
    .leftJoin(
      manager,
      and(
        eq(manager.participantId, cycleParticipant.id),
        eq(manager.relationship, "manager"),
        isNull(manager.deletedAt),
      ),
    )
    .where(
      and(
        eq(cycleParticipant.snapManagerPersonId, actor.personId),
        isNull(cycleParticipant.removedAt),
        isNull(reviewCycle.deletedAt),
        notInArray(reviewCycle.status, ["draft", "closed"]),
      ),
    )
    .orderBy(asc(reviewCycle.name), asc(person.displayName));
}

/**
 * Sends a manual reminder ("Recordar") about a request to its reviewer (only
 * the participant's manager or HR): a `manual_reminder` notification in their
 * inbox, at most one per sender and request per day (see notifications
 * `remind`). Not loadRequest: the manager may remind about a self review they
 * cannot read yet (double blind).
 */
export async function sendReminder(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<void> {
  try {
    await remind(db, actor, requestId);
  } catch (error) {
    if (error instanceof NotificationError) {
      throw new ReviewError(REMIND_ERRORS[error.code], error.issues);
    }
    throw error;
  }
}

const REMIND_ERRORS: Record<NotificationErrorCode, ReviewErrorCode> = {
  not_found: "not_found",
  forbidden: "forbidden",
  not_pending: "not_remindable",
  validation: "validation",
};

export type ParticipantRefs = {
  revieweeName: string;
  selfRequestId: string | null;
  participant: { snapManagerPersonId: string | null; removedAt: Date | null };
  cycle: {
    status: CycleStatus;
    components: ReviewCycle["components"];
    calibrationPublishedAt: Date | null;
  };
};

/**
 * Reviewee name, self request id, and what canShare/shareableNow need, for
 * the manager form. Only ids: reading still goes through getReview/canRead.
 */
export async function participantRefs(
  db: DbOrTx,
  participantId: string,
): Promise<ParticipantRefs | null> {
  if (!isUuid(participantId)) return null;
  const [row] = await db
    .select({
      revieweeName: person.displayName,
      selfRequestId: reviewRequest.id,
      participant: {
        snapManagerPersonId: cycleParticipant.snapManagerPersonId,
        removedAt: cycleParticipant.removedAt,
      },
      cycle: {
        status: reviewCycle.status,
        components: reviewCycle.components,
        calibrationPublishedAt: reviewCycle.calibrationPublishedAt,
      },
    })
    .from(cycleParticipant)
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .leftJoin(
      reviewRequest,
      and(
        eq(reviewRequest.participantId, cycleParticipant.id),
        eq(reviewRequest.relationship, "self"),
        isNull(reviewRequest.deletedAt),
      ),
    )
    .where(eq(cycleParticipant.id, participantId));
  return row ?? null;
}
