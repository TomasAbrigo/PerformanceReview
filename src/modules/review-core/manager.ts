import { and, asc, eq, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import {
  type CycleParticipant,
  type ReviewCycle,
  cycleParticipant,
  person,
  reviewAudit,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { jobAsOf } from "@/modules/org-history/queries";
import type { RequestStatus } from "./request-status";
import { ReviewError } from "./review-errors";
import type { CycleStatus } from "./status";
import { isActiveParticipant } from "./visibility";

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
 * Whether HR replaced the participant's snapshot manager as the reviewer of
 * their (primary) manager review (#17 assignAlternateAssessor, mode replace):
 * the request goes to someone else on purpose. The replaced manager no longer
 * reads or shares that participant's reviews or sees them in their team; an
 * additional assessor, or a reassignment back to them, changes nothing.
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

/**
 * Id of the manager request of a participant, when the actor may open it
 * (its reviewer, the snapshot manager unless replaced, or HR).
 */
export async function findManagerRequestId(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
): Promise<string | null> {
  if (!isUuid(participantId)) return null;
  // A participant may have several manager requests (additional assessors,
  // #17; superseded ones are history): the actor's own first, else the primary.
  const rows = await db
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
        ne(reviewRequest.status, "superseded"),
      ),
    )
    .orderBy(asc(reviewRequest.additional), asc(reviewRequest.requestedAt));
  const row =
    rows.find((r) => actor.personId && r.reviewer === actor.personId) ??
    rows[0];
  if (!row) return null;
  if (actor.role === "hr") return row.id;
  if (actor.personId === null) return null;
  if (actor.personId === row.reviewer) return row.id;
  const isManager = actor.personId === row.manager;
  const replaced =
    isManager &&
    (await isManagerReplaced(db, {
      id: participantId,
      snapManagerPersonId: row.manager,
    }));
  return isManager && !replaced ? row.id : null;
}

export type TeamRow = {
  cycleId: string;
  cycleName: string;
  cycleStatus: CycleStatus;
  participantId: string;
  revieweeName: string;
  selfRequestId: string | null;
  selfStatus: RequestStatus | null;
  managerRequestId: string | null;
  managerStatus: RequestStatus | null;
  sharedAt: Date | null;
};

/**
 * The actor's direct reports (as of each cycle's snapshot) in active cycles,
 * plus the people whose manager review they were assigned (#17), with the
 * status of their self and manager reviews.
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
      // One manager request per row (#17: additional assessors, superseded
      // history): the actor's own, else the primary one.
      eq(
        manager.id,
        sql`(select rr.id from review_request rr
          where rr.participant_id = ${cycleParticipant.id}
            and rr.relationship = 'manager' and rr.deleted_at is null
            and rr.status <> 'superseded'
          order by coalesce(rr.reviewer_person_id = ${actor.personId}, false) desc,
            rr.additional, rr.requested_at
          limit 1)`,
      ),
    )
    .where(
      and(
        or(
          and(
            eq(cycleParticipant.snapManagerPersonId, actor.personId),
            // ...unless HR replaced them as reviewer (see isManagerReplaced).
            sql`not exists (select 1 from review_request rr
              where rr.participant_id = ${cycleParticipant.id}
                and rr.relationship = 'manager' and not rr.additional
                and rr.assigned_by_hr and rr.status <> 'superseded'
                and rr.deleted_at is null
                and rr.reviewer_person_id <> ${cycleParticipant.snapManagerPersonId})`,
          ),
          // Alternate/additional assessors (#17) see who they review.
          sql`exists (select 1 from review_request rr
            where rr.participant_id = ${cycleParticipant.id}
              and rr.relationship = 'manager' and rr.deleted_at is null
              and rr.status <> 'superseded'
              and rr.reviewer_person_id = ${actor.personId})`,
        ),
        isNull(cycleParticipant.removedAt),
        isNull(reviewCycle.deletedAt),
        notInArray(reviewCycle.status, ["draft", "closed"]),
      ),
    )
    .orderBy(asc(reviewCycle.name), asc(person.displayName));
}

/**
 * Records a manual reminder to a direct report (only their manager or HR).
 * #18 replaces this with the internal inbox; for now it is an audit row.
 */
export async function sendReminder(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<void> {
  // Not loadRequest: the manager may remind about a self review they cannot
  // read yet (double blind).
  const [row] = isUuid(requestId)
    ? await db
        .select({
          participantId: cycleParticipant.id,
          manager: cycleParticipant.snapManagerPersonId,
          removedAt: cycleParticipant.removedAt,
          status: reviewRequest.status,
          cycleStatus: reviewCycle.status,
          cycleDeletedAt: reviewCycle.deletedAt,
        })
        .from(reviewRequest)
        .innerJoin(
          cycleParticipant,
          eq(cycleParticipant.id, reviewRequest.participantId),
        )
        .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
        .where(
          and(eq(reviewRequest.id, requestId), isNull(reviewRequest.deletedAt)),
        )
    : [];
  if (!row || row.cycleDeletedAt) throw new ReviewError("not_found");
  const isManager =
    actor.personId !== null &&
    actor.personId === row.manager &&
    // A snapshot manager HR replaced as reviewer no longer manages the review.
    !(await isManagerReplaced(db, {
      id: row.participantId,
      snapManagerPersonId: row.manager,
    }));
  if (actor.role !== "hr" && !isManager) throw new ReviewError("forbidden");
  if (
    row.status !== "draft" ||
    !isActiveParticipant(row) ||
    row.cycleStatus === "draft" ||
    row.cycleStatus === "closed"
  ) {
    throw new ReviewError("not_remindable");
  }
  await db.insert(reviewAudit).values({
    requestId,
    action: "reminder_sent",
    actorPersonId: actor.personId,
  });
}

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
