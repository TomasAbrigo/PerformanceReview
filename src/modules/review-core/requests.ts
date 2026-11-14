import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  reviewAudit,
  reviewCycle,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import {
  type AckTask,
  acknowledgeDeadline,
  DEFAULT_ACK_WINDOW_DAYS,
} from "./acknowledge-window";
import { currentManagerOf, skipLevelParticipants } from "./manager";
import { managerReplacedAmong } from "./manager-replaced";
import {
  ensureUpwardRequests,
  type FeedbackTask,
  feedbackTasks,
  type NominationTask,
  nominationTasks,
} from "./peers";
import type { RequestStatus } from "./request-status";
import { ReviewError } from "./review-errors";
import type { CycleStatus } from "./status";
import { canRead, type VisibilityContext } from "./visibility";

/**
 * Ensures the requests of a cycle (self, then manager: see
 * ensureManagerRequests) for every active participant (or only
 * `participantId`). Called on launch, transitions and added participants.
 */
export async function ensureSelfRequests(
  db: DbOrTx,
  cycleId: string,
  participantId?: string,
): Promise<void> {
  await ensureOnlySelfRequests(db, cycleId, participantId);
  await ensureManagerRequests(db, cycleId, participantId);
  await ensureUpwardRequests(db, cycleId, participantId);
}

/**
 * Creates the self request of every active participant of a cycle (or only
 * of `participantId`) when the cycle is collecting with the self component
 * on. Idempotent: existing requests are left as they are.
 */
async function ensureOnlySelfRequests(
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

/** Phases in which manager reviews exist (and can be written). */
const MANAGER_PHASES: CycleStatus[] = [
  "collecting",
  "manager_review",
  "calibration",
  "sharing",
];

/**
 * Creates the manager request of every active participant (or only
 * `participantId`) once the cycle is collecting (or later, but not closed)
 * with the manager component on. The reviewer is the snapshot manager; a
 * participant without one gets a request with no reviewer flagged
 * reviewer_missing (#17 assigns alternates). Idempotent.
 */
export async function ensureManagerRequests(
  db: DbOrTx,
  cycleId: string,
  participantId?: string,
): Promise<void> {
  const [cycle] = await db
    .select({ status: reviewCycle.status, components: reviewCycle.components })
    .from(reviewCycle)
    .where(eq(reviewCycle.id, cycleId));
  if (
    !cycle ||
    !MANAGER_PHASES.includes(cycle.status) ||
    !cycle.components.manager
  ) {
    return;
  }
  const participants = await db
    .select({
      id: cycleParticipant.id,
      managerId: cycleParticipant.snapManagerPersonId,
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
  // A participant keeps a single manager request. When the snapshot
  // manager changed (e.g. re-added after a manager change), a draft is
  // reassigned (audited); a submitted one is kept and flagged. Only the
  // primary request counts: additional assessors and superseded history
  // (#17) are left alone, and so is a draft HR assigned to another reviewer
  // on purpose (assigned_by_hr, see assignAlternateAssessor). A stale
  // mismatch (e.g. a flagged review HR unlocked) does follow the snapshot.
  const existing = new Map(
    (
      await db
        .select({
          id: reviewRequest.id,
          participantId: reviewRequest.participantId,
          reviewer: reviewRequest.reviewerPersonId,
          status: reviewRequest.status,
          mismatch: reviewRequest.reviewerMismatch,
          assignedByHr: reviewRequest.assignedByHr,
        })
        .from(reviewRequest)
        .where(
          and(
            eq(reviewRequest.relationship, "manager"),
            eq(reviewRequest.additional, false),
            ne(reviewRequest.status, "superseded"),
            isNull(reviewRequest.deletedAt),
            inArray(
              reviewRequest.participantId,
              participants.map((p) => p.id),
            ),
          ),
        )
    ).map((r) => [r.participantId, r]),
  );
  for (const p of participants) {
    const request = existing.get(p.id);
    if (!request || request.reviewer === p.managerId) continue;
    if (request.status === "draft") {
      if (request.assignedByHr) continue; // assigned on purpose (#17)
      await db
        .update(reviewRequest)
        .set({
          reviewerPersonId: p.managerId,
          reviewerMissing: p.managerId === null,
          reviewerMismatch: false,
          requestedAt: new Date(),
        })
        .where(eq(reviewRequest.id, request.id));
      await db.insert(reviewAudit).values({
        requestId: request.id,
        action: "reviewer_reassigned",
        note: request.reviewer,
      });
    } else if (!request.mismatch) {
      await db
        .update(reviewRequest)
        .set({ reviewerMismatch: true })
        .where(eq(reviewRequest.id, request.id));
    }
  }
  const missing = participants.filter((p) => !existing.has(p.id));
  if (missing.length === 0) return;
  await db
    .insert(reviewRequest)
    .values(
      missing.map((p) => ({
        cycleId,
        participantId: p.id,
        reviewerPersonId: p.managerId,
        reviewerMissing: p.managerId === null,
        relationship: "manager" as const,
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

/**
 * The fields of a request, its participant and its cycle that canRead (and
 * what it needs beyond the row) reads: a LoadedRow, or anything selected
 * with those columns.
 */
export type VisibilityRow = {
  request: Pick<
    ReviewRequest,
    "relationship" | "reviewerPersonId" | "status" | "sharedAt"
  >;
  participant: Pick<
    typeof cycleParticipant.$inferSelect,
    | "id"
    | "revieweePersonId"
    | "snapManagerPersonId"
    | "snapshotAsOf"
    | "removedAt"
  >;
  cycle: Pick<
    typeof reviewCycle.$inferSelect,
    "status" | "components" | "anonymity"
  >;
};

/**
 * What canRead needs beyond the rows, for many rows of one actor at once
 * (the lists read a page at a time): the participants' manager requests
 * (double blind, who wrote them, shared), whether the actor was replaced as
 * snapshot manager, whether peer feedback is released and whether the actor
 * is skip-level or the reviewee's current manager. Each extra
 * is one query per call, for the rows that need it, never one per row; none
 * when the actor is HR or has no person. Rows the actor wrote need nothing
 * (they read their own).
 */
export async function visibilityContexts(
  db: DbOrTx,
  actor: ActorContext,
  rows: VisibilityRow[],
): Promise<VisibilityContext[]> {
  const contexts: VisibilityContext[] = rows.map((row) => ({ ...row }));
  const me = actor.personId;
  if (actor.role === "hr" || me === null) return contexts;
  const pending = rows
    .map((row, i) => ({ row, ctx: contexts[i] }))
    .filter(({ row }) => row.request.reviewerPersonId !== me);
  const idsOf = (list: typeof pending) => [
    ...new Set(list.map(({ row }) => row.participant.id)),
  ];

  const selfRows = pending.filter(
    ({ row }) => row.request.relationship === "self",
  );
  if (selfRows.length > 0) {
    // A participant may have several manager requests (#17: additional
    // assessors; superseded ones are history, not the current double-blind
    // gate): the actor's own wins, else the primary one.
    const managerRequests = await db
      .select({
        participantId: reviewRequest.participantId,
        status: reviewRequest.status,
        reviewer: reviewRequest.reviewerPersonId,
        sharedAt: reviewRequest.sharedAt,
      })
      .from(reviewRequest)
      .where(
        and(
          inArray(reviewRequest.participantId, idsOf(selfRows)),
          eq(reviewRequest.relationship, "manager"),
          isNull(reviewRequest.deletedAt),
          ne(reviewRequest.status, "superseded"),
        ),
      )
      .orderBy(asc(reviewRequest.additional), asc(reviewRequest.requestedAt));
    for (const { row, ctx } of selfRows) {
      const mine = managerRequests.filter(
        (r) => r.participantId === row.participant.id,
      );
      const own = mine.find((r) => r.reviewer === me);
      ctx.assessor = !!own;
      ctx.managerRequest = own ?? mine[0] ?? null;
    }
  }

  // A snapshot manager HR replaced as reviewer loses manager-side access.
  const asManager = pending.filter(
    ({ row }) => row.participant.snapManagerPersonId === me,
  );
  if (asManager.length > 0) {
    const replaced = await managerReplacedAmong(db, idsOf(asManager));
    for (const { row, ctx } of asManager) {
      ctx.snapManagerReplaced = replaced.has(row.participant.id);
    }
  }

  // Peer/upward feedback read by the reviewee: released with the share.
  const asReviewee = pending.filter(
    ({ row }) =>
      (row.request.relationship === "peer" ||
        row.request.relationship === "upward") &&
      row.participant.revieweePersonId === me,
  );
  if (asReviewee.length > 0) {
    const needShare = asReviewee.filter(
      ({ row }) =>
        peerFeedbackReleased(row.cycle) && row.cycle.components.manager,
    );
    const shared = await sharedManagerReviews(db, idsOf(needShare));
    for (const { row, ctx } of asReviewee) {
      ctx.revieweeShared =
        peerFeedbackReleased(row.cycle) &&
        (!row.cycle.components.manager || shared.has(row.participant.id));
    }
  }

  // The snapshot manager and the reviewee are decided without skip-level.
  const undecided = pending.filter(
    ({ row }) =>
      row.participant.snapManagerPersonId !== me &&
      row.participant.revieweePersonId !== me,
  );
  if (undecided.length > 0) {
    const skip = await skipLevelParticipants(
      db,
      actor,
      undecided.map(({ row }) => row.participant),
    );
    // Whoever manages the reviewee today follows their trajectory (#15).
    const current = await currentManagerOf(
      db,
      actor,
      undecided.map(({ row }) => row.participant.revieweePersonId),
    );
    for (const { row, ctx } of undecided) {
      ctx.skipLevel = skip.has(row.participant.id);
      ctx.currentManager = current.has(row.participant.revieweePersonId);
    }
  }
  return contexts;
}

/** The cycle phases that release peer/upward feedback to the reviewee. */
const peerFeedbackReleased = (cycle: Pick<VisibilityRow["cycle"], "status">) =>
  cycle.status === "sharing" || cycle.status === "closed";

/** Ids (of the given participants) whose manager review was shared with them. */
async function sharedManagerReviews(
  db: DbOrTx,
  participantIds: string[],
): Promise<Set<string>> {
  if (participantIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ id: reviewRequest.participantId })
    .from(reviewRequest)
    .where(
      and(
        inArray(reviewRequest.participantId, participantIds),
        eq(reviewRequest.relationship, "manager"),
        isNotNull(reviewRequest.sharedAt),
        isNull(reviewRequest.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Whether peer/upward feedback is released to the reviewee: the cycle is in
 * sharing (or closed) and, when the cycle has manager reviews, the
 * participant's manager review was shared; without managers, the phase
 * alone releases it.
 */
export async function peerFeedbackShared(
  db: DbOrTx,
  row: Pick<VisibilityRow, "cycle"> & {
    participant: Pick<VisibilityRow["participant"], "id">;
  },
): Promise<boolean> {
  if (!peerFeedbackReleased(row.cycle)) return false;
  if (!row.cycle.components.manager) return true;
  return (await sharedManagerReviews(db, [row.participant.id])).has(
    row.participant.id,
  );
}

/** A request with what visibility needs; throws not_found / forbidden. */
export async function loadRequest(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  { forUpdate = false } = {},
) {
  if (!isUuid(requestId)) throw new ReviewError("not_found");
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
  const [visibility] = await visibilityContexts(db, actor, [row]);
  if (!canRead(actor, visibility)) throw new ReviewError("forbidden");
  return { ...row, visibility };
}

/** Id of the actor's own self request in a cycle, if any. */
export async function findMySelfRequestId(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<string | null> {
  if (!actor.personId || !isUuid(cycleId)) return null;
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
  if (actor.role !== "hr" || !isUuid(cycleId)) return [];
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

export type SharedReviewTask = {
  requestId: string;
  cycleId: string;
  cycleName: string;
  sharedAt: Date | null;
};

/** Pending work of the actor. */
export type MyTasks = {
  selfAssessments: SelfAssessmentTask[];
  /** Manager reviews shared with the actor ("Evaluación compartida"). */
  sharedReviews: SharedReviewTask[];
  /** Cycles where the actor still nominates peers. */
  nominations: NominationTask[];
  /** Peer/upward feedback the actor has to write. */
  feedback: FeedbackTask[];
  /** Shared reviews still to acknowledge ("Acusar recibo"), window open. */
  acknowledgements: AckTask[];
};

export async function listMyTasks(
  db: DbOrTx,
  actor: ActorContext,
  {
    now = new Date(),
    ackWindowDays = DEFAULT_ACK_WINDOW_DAYS,
  }: { now?: Date; ackWindowDays?: number } = {},
): Promise<MyTasks> {
  const empty: MyTasks = {
    selfAssessments: [],
    sharedReviews: [],
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
      dueDate: sql<
        string | null
      >`coalesce(${cycleParticipant.dueDates}->>'self', ${reviewCycle.dueDates}->>'self')`,
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
    .orderBy(
      asc(
        sql`coalesce(${cycleParticipant.dueDates}->>'self', ${reviewCycle.dueDates}->>'self')`,
      ),
      asc(reviewCycle.name),
    );
  const sharedRows = await db
    .select({
      requestId: reviewRequest.id,
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      sharedAt: reviewRequest.sharedAt,
      participantId: cycleParticipant.id,
      acknowledgedAt: cycleParticipant.acknowledgedAt,
      ackDueDate: sql<
        string | null
      >`coalesce(${cycleParticipant.dueDates}->>'acknowledge', ${reviewCycle.dueDates}->>'acknowledge')`,
    })
    .from(reviewRequest)
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .where(
      and(
        eq(cycleParticipant.revieweePersonId, actor.personId),
        eq(reviewRequest.relationship, "manager"),
        eq(reviewRequest.status, "submitted"),
        isNotNull(reviewRequest.sharedAt),
        isNull(reviewRequest.deletedAt),
        isNull(cycleParticipant.removedAt),
        isNull(reviewCycle.deletedAt),
      ),
    )
    .orderBy(asc(reviewRequest.sharedAt));
  const sharedReviews = sharedRows.map((r) => ({
    requestId: r.requestId,
    cycleId: r.cycleId,
    cycleName: r.cycleName,
    sharedAt: r.sharedAt,
  }));
  // The shared reviews not acknowledged yet, while their window is open.
  const acknowledgements = sharedRows.flatMap((r) => {
    if (r.acknowledgedAt || !r.sharedAt) return [];
    const deadline = acknowledgeDeadline({
      sharedAt: r.sharedAt,
      dueDate: r.ackDueDate,
      windowDays: ackWindowDays,
    });
    return now.getTime() <= deadline.getTime()
      ? [
          {
            participantId: r.participantId,
            cycleId: r.cycleId,
            cycleName: r.cycleName,
            sharedAt: r.sharedAt,
            deadline,
          },
        ]
      : [];
  });
  return {
    ...empty,
    selfAssessments: rows,
    sharedReviews,
    acknowledgements,
    nominations: await nominationTasks(db, actor.personId),
    feedback: await feedbackTasks(db, actor.personId),
  };
}

/** Id of the actor's manager review in a cycle, once shared with them. */
export async function findMySharedReviewId(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<string | null> {
  if (!actor.personId || !isUuid(cycleId)) return null;
  const [row] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        eq(reviewRequest.relationship, "manager"),
        eq(cycleParticipant.revieweePersonId, actor.personId),
        eq(reviewRequest.status, "submitted"),
        isNull(cycleParticipant.removedAt),
        isNotNull(reviewRequest.sharedAt),
        isNull(reviewRequest.deletedAt),
      ),
    );
  return row?.id ?? null;
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
  if (!personId || !isUuid(personId)) return null;
  const [row] = await db
    .select({ name: person.displayName })
    .from(person)
    .where(eq(person.id, personId));
  return row?.name ?? null;
}
