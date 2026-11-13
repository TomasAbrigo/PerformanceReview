import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  reviewAudit,
  reviewCycle,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import type { RequestStatus } from "./request-status";
import { ReviewError } from "./review-errors";
import { canRead } from "./visibility";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Creates the self request of every active participant of a cycle (or only
 * of `participantId`) when the cycle is collecting with the self component
 * on. Idempotent: existing requests are left as they are.
 */
export async function ensureSelfRequests(
  db: DbOrTx,
  cycleId: string,
  participantId?: string,
): Promise<void> {
  const [cycle] = await db
    .select({ status: reviewCycle.status, components: reviewCycle.components })
    .from(reviewCycle)
    .where(eq(reviewCycle.id, cycleId));
  if (!cycle || cycle.status !== "collecting" || !cycle.components.self) {
    return;
  }
  const participants = await db
    .select({
      id: cycleParticipant.id,
      personId: cycleParticipant.revieweePersonId,
    })
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        isNull(cycleParticipant.removedAt),
        participantId ? eq(cycleParticipant.id, participantId) : undefined,
      ),
    );
  if (participants.length === 0) return;
  await db
    .insert(reviewRequest)
    .values(
      participants.map((p) => ({
        cycleId,
        participantId: p.id,
        reviewerPersonId: p.personId,
        relationship: "self" as const,
      })),
    )
    .onConflictDoNothing({
      target: [
        reviewRequest.participantId,
        reviewRequest.relationship,
        reviewRequest.reviewerPersonId,
      ],
    });
}

/** A request with what visibility needs; throws not_found / forbidden. */
export async function loadRequest(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  { forUpdate = false } = {},
) {
  if (!UUID.test(requestId)) throw new ReviewError("not_found");
  const query = db
    .select({
      request: reviewRequest,
      participant: cycleParticipant,
      cycle: reviewCycle,
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .where(
      and(eq(reviewRequest.id, requestId), isNull(reviewRequest.deletedAt)),
    );
  const [row] = forUpdate
    ? await query.for("update", { of: reviewRequest })
    : await query;
  if (!row || row.cycle.deletedAt) throw new ReviewError("not_found");
  if (!canRead(actor, row)) throw new ReviewError("forbidden");
  return row;
}

/** Id of the actor's own self request in a cycle, if any. */
export async function findMySelfRequestId(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<string | null> {
  if (!actor.personId || !UUID.test(cycleId)) return null;
  const [row] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        eq(reviewRequest.relationship, "self"),
        eq(reviewRequest.reviewerPersonId, actor.personId),
        isNull(reviewRequest.deletedAt),
      ),
    );
  return row?.id ?? null;
}

export type SelfRequestItem = {
  requestId: string;
  participantId: string;
  status: RequestStatus;
  submittedAt: Date | null;
};

/** Self request status per participant of a cycle (HR view; others: none). */
export async function listSelfRequests(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<SelfRequestItem[]> {
  if (actor.role !== "hr" || !UUID.test(cycleId)) return [];
  return db
    .select({
      requestId: reviewRequest.id,
      participantId: reviewRequest.participantId,
      status: reviewRequest.status,
      submittedAt: reviewRequest.submittedAt,
    })
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        eq(reviewRequest.relationship, "self"),
        isNull(reviewRequest.deletedAt),
      ),
    );
}

export type SelfAssessmentTask = {
  requestId: string;
  cycleId: string;
  cycleName: string;
  dueDate: string | null;
  status: RequestStatus;
};

/** Pending work of the actor; only self assessments exist for now. */
export type MyTasks = {
  selfAssessments: SelfAssessmentTask[];
  /** #13: peers to nominate / approve. */
  nominations: never[];
  /** #14: feedback to give to peers / managers. */
  feedback: never[];
  /** #15: shared reviews to acknowledge. */
  acknowledgements: never[];
};

export async function listMyTasks(
  db: DbOrTx,
  actor: ActorContext,
): Promise<MyTasks> {
  const empty: MyTasks = {
    selfAssessments: [],
    nominations: [],
    feedback: [],
    acknowledgements: [],
  };
  if (!actor.personId) return empty;
  const rows = await db
    .select({
      requestId: reviewRequest.id,
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      dueDate: sql<string | null>`${reviewCycle.dueDates}->>'self'`,
      status: reviewRequest.status,
    })
    .from(reviewRequest)
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .where(
      and(
        eq(reviewRequest.reviewerPersonId, actor.personId),
        eq(reviewRequest.relationship, "self"),
        eq(reviewRequest.status, "draft"),
        isNull(reviewRequest.deletedAt),
        isNull(cycleParticipant.removedAt),
        isNull(reviewCycle.deletedAt),
        ne(reviewCycle.status, "closed"),
      ),
    )
    .orderBy(asc(sql`${reviewCycle.dueDates}->>'self'`), asc(reviewCycle.name));
  return { ...empty, selfAssessments: rows };
}

/** HR returns a submitted request to draft; the unlock is audited. */
export async function unlock(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  note: string | null,
): Promise<ReviewRequest> {
  if (actor.role !== "hr") throw new ReviewError("forbidden");
  return db.transaction(async (tx) => {
    const { request } = await loadRequest(tx, actor, requestId, {
      forUpdate: true,
    });
    if (request.status !== "submitted") throw new ReviewError("not_submitted");
    const now = new Date();
    const [updated] = await tx
      .update(reviewRequest)
      .set({
        status: "draft",
        submittedAt: null,
        unlockedAt: now,
        unlockedBy: actor.personId,
      })
      .where(eq(reviewRequest.id, requestId))
      .returning();
    await tx.insert(reviewAudit).values({
      requestId,
      action: "unlock",
      actorPersonId: actor.personId,
      note: note?.trim() || null,
    });
    return updated;
  });
}

/** Display name of a person (header "acting as"). */
export async function personName(
  db: DbOrTx,
  personId: string | null,
): Promise<string | null> {
  if (!personId || !UUID.test(personId)) return null;
  const [row] = await db
    .select({ name: person.displayName })
    .from(person)
    .where(eq(person.id, personId));
  return row?.name ?? null;
}
