import {
  and,
  arrayOverlaps,
  asc,
  count,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  cycleParticipant,
  type CycleParticipant,
  employment,
  peerNomination,
  type PeerNomination,
  person,
  questionRevision,
  reviewCycle,
  type ReviewCycle,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import type { Relationship } from "@/modules/templates/constants";
import { answerValueOf, type Review } from "./answers";
import {
  type NominationStatus,
  type PeerApproval,
  peerSettingsOf,
} from "./peer-settings";
import { loadRequest, peerFeedbackShared } from "./requests";
import { ReviewError } from "./review-errors";
import type { CycleStatus } from "./status";
import {
  canRead,
  isActorPerson,
  reviewerVisible,
  writablePhases,
} from "./visibility";

/** Phases in which upward reviews exist (same as manager reviews). */
const UPWARD_PHASES: CycleStatus[] = [
  "collecting",
  "manager_review",
  "calibration",
  "sharing",
];
/** Nominations that take a slot. */
const LIVE: NominationStatus[] = ["pending", "approved"];

const isHr = (actor: ActorContext) => actor.role === "hr";
const isManagerOf = (actor: ActorContext, p: CycleParticipant) =>
  isActorPerson(actor, p.snapManagerPersonId);
const isRevieweeOf = (actor: ActorContext, p: CycleParticipant) =>
  isActorPerson(actor, p.revieweePersonId);

async function participantWithCycle(
  db: DbOrTx,
  participantId: string,
  { forUpdate = false } = {},
) {
  if (!isUuid(participantId)) throw new ReviewError("not_found");
  const query = db
    .select({ participant: cycleParticipant, cycle: reviewCycle })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .where(eq(cycleParticipant.id, participantId));
  const [row] = forUpdate
    ? await query.for("update", { of: cycleParticipant })
    : await query;
  if (!row || row.cycle.deletedAt || row.participant.removedAt) {
    throw new ReviewError("not_found");
  }
  return row;
}

/**
 * A person is active when they have a live employment and the latest one is
 * not Inactive. Single definition, used as a SQL condition.
 */
const isActivePersonSql = (personId: AnyPgColumn): SQL =>
  sql`coalesce((select lower(coalesce(e.status, '')) from ${employment} e
    where e.person_id = ${personId} and e.deleted_at is null
    order by e.hire_date desc nulls last limit 1), 'inactive') <> 'inactive'`;

async function isActivePerson(db: DbOrTx, personId: string) {
  if (!isUuid(personId)) return false;
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.id, personId), isActivePersonSql(person.id)));
  return !!row;
}

const anonymousFor = (cycle: ReviewCycle, rel: "peer" | "upward") =>
  cycle.anonymity[rel] !== "transparent";

/** The peer request of an approved nomination. Idempotent. */
async function ensurePeerRequest(
  db: DbOrTx,
  cycle: ReviewCycle,
  n: Pick<PeerNomination, "participantId" | "nomineePersonId">,
) {
  await db
    .insert(reviewRequest)
    .values({
      cycleId: cycle.id,
      participantId: n.participantId,
      reviewerPersonId: n.nomineePersonId,
      relationship: "peer",
      anonymous: anonymousFor(cycle, "peer"),
    })
    .onConflictDoNothing({
      target: [
        reviewRequest.participantId,
        reviewRequest.relationship,
        reviewRequest.reviewerPersonId,
      ],
    });
}

/**
 * Nominates a peer for a participant (the reviewee, or HR on their behalf)
 * during the nominations phase. Not self, not the snapshot manager, only
 * active people, up to the cycle's maximum (pending + approved).
 */
export async function nominatePeer(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  nomineePersonId: string,
): Promise<PeerNomination> {
  return db.transaction(async (tx) => {
    const { participant, cycle } = await participantWithCycle(
      tx,
      participantId,
      { forUpdate: true },
    );
    if (!isHr(actor) && !isRevieweeOf(actor, participant)) {
      throw new ReviewError("forbidden");
    }
    if (cycle.status !== "nominations" || !cycle.components.peer) {
      throw new ReviewError("wrong_phase");
    }
    if (
      nomineePersonId === participant.revieweePersonId ||
      nomineePersonId === participant.snapManagerPersonId ||
      !(await isActivePerson(tx, nomineePersonId))
    ) {
      throw new ReviewError("invalid_nominee");
    }
    const rows = await tx
      .select()
      .from(peerNomination)
      .where(eq(peerNomination.participantId, participantId));
    const existing = rows.find((r) => r.nomineePersonId === nomineePersonId);
    if (existing && existing.status !== "removed") {
      throw new ReviewError("already_nominated");
    }
    const live = rows.filter((r) => LIVE.includes(r.status)).length;
    if (live >= peerSettingsOf(cycle.components).maxNominations) {
      throw new ReviewError("nominations_full");
    }
    // Without approval a nomination is approved (and requested) at once.
    const auto = peerSettingsOf(cycle.components).approval === "none";
    const values = {
      status: auto ? ("approved" as const) : ("pending" as const),
      nominatedByPersonId: actor.personId,
      decidedBy: null,
      decidedAt: auto ? new Date() : null,
    };
    const [saved] = existing
      ? await tx
          .update(peerNomination)
          .set(values)
          .where(eq(peerNomination.id, existing.id))
          .returning()
      : await tx
          .insert(peerNomination)
          .values({
            ...values,
            cycleId: cycle.id,
            participantId,
            nomineePersonId,
          })
          .returning();
    if (auto) await ensurePeerRequest(tx, cycle, saved);
    return saved;
  });
}

/** The reviewee (or HR) withdraws a pending nomination. */
export async function removeNomination(
  db: DbOrTx,
  actor: ActorContext,
  nominationId: string,
): Promise<void> {
  if (!isUuid(nominationId)) throw new ReviewError("not_found");
  await db.transaction(async (tx) => {
    const [n] = await tx
      .select()
      .from(peerNomination)
      .where(eq(peerNomination.id, nominationId));
    if (!n) throw new ReviewError("not_found");
    const { participant, cycle } = await participantWithCycle(
      tx,
      n.participantId,
    );
    if (!isHr(actor) && !isRevieweeOf(actor, participant)) {
      throw new ReviewError("forbidden");
    }
    if (cycle.status !== "nominations") throw new ReviewError("wrong_phase");
    if (n.status !== "pending") throw new ReviewError("forbidden");
    await tx
      .update(peerNomination)
      .set({ status: "removed" })
      .where(eq(peerNomination.id, nominationId));
  });
}

/**
 * The snapshot manager (or HR) approves or declines pending nominations,
 * one or many. Approving creates the peer request. Nominations already
 * decided are left as they are (idempotent). Cycles without approval
 * (approval 'none') reject it: their nominations are approved on creation.
 */
export async function decideNominations(
  db: DbOrTx,
  actor: ActorContext,
  nominationIds: string[],
  decision: "approved" | "declined",
): Promise<number> {
  const ids = [...new Set(nominationIds.filter(isUuid))];
  if (ids.length === 0) return 0;
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        n: peerNomination,
        participant: cycleParticipant,
        cycle: reviewCycle,
      })
      .from(peerNomination)
      .innerJoin(
        cycleParticipant,
        eq(cycleParticipant.id, peerNomination.participantId),
      )
      .innerJoin(reviewCycle, eq(reviewCycle.id, peerNomination.cycleId))
      .where(inArray(peerNomination.id, ids))
      .for("update", { of: peerNomination });
    if (
      rows.length !== ids.length ||
      rows.some((r) => r.cycle.deletedAt || r.participant.removedAt)
    ) {
      throw new ReviewError("not_found");
    }
    for (const { participant, cycle } of rows) {
      if (!isHr(actor) && !isManagerOf(actor, participant)) {
        throw new ReviewError("forbidden");
      }
      if (cycle.status !== "nominations") throw new ReviewError("wrong_phase");
      if (peerSettingsOf(cycle.components).approval === "none") {
        throw new ReviewError("no_approval");
      }
    }
    let changed = 0;
    for (const { n, cycle } of rows) {
      if (n.status !== "pending") continue;
      await tx
        .update(peerNomination)
        .set({
          status: decision,
          decidedBy: actor.personId,
          decidedAt: new Date(),
        })
        .where(eq(peerNomination.id, n.id));
      if (decision === "approved") await ensurePeerRequest(tx, cycle, n);
      changed++;
    }
    return changed;
  });
}

/**
 * Leaving the nominations phase: pending nominations are approved when the
 * cycle needs no approval, declined otherwise.
 */
export async function closeNominations(
  db: DbOrTx,
  cycle: ReviewCycle,
): Promise<void> {
  const approve = peerSettingsOf(cycle.components).approval === "none";
  const pending = await db
    .update(peerNomination)
    .set({
      status: approve ? "approved" : "declined",
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(peerNomination.cycleId, cycle.id),
        eq(peerNomination.status, "pending"),
      ),
    )
    .returning();
  if (approve) {
    for (const n of pending) await ensurePeerRequest(db, cycle, n);
  }
}

/**
 * Upward requests: each active participant writes one about their snapshot
 * manager when the manager is also a participant of the cycle (participant =
 * the manager, reviewer = the report). Created from collecting on, with the
 * upward component on. Idempotent; with `participantId`, only the pairs
 * that participant is part of (as manager or as report). Aggregation and a
 * minimum number of respondents are v2.
 */
export async function ensureUpwardRequests(
  db: DbOrTx,
  cycleId: string,
  participantId?: string,
): Promise<void> {
  const [cycle] = await db
    .select()
    .from(reviewCycle)
    .where(eq(reviewCycle.id, cycleId));
  if (
    !cycle ||
    !cycle.components.upward ||
    !UPWARD_PHASES.includes(cycle.status)
  ) {
    return;
  }
  const report = alias(cycleParticipant, "report");
  const pairs = await db
    .select({
      participantId: cycleParticipant.id,
      reviewer: report.revieweePersonId,
    })
    .from(cycleParticipant)
    .innerJoin(
      report,
      and(
        eq(report.cycleId, cycleParticipant.cycleId),
        eq(report.snapManagerPersonId, cycleParticipant.revieweePersonId),
        isNull(report.removedAt),
      ),
    )
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        isNull(cycleParticipant.removedAt),
        participantId
          ? or(
              eq(cycleParticipant.id, participantId),
              eq(report.id, participantId),
            )
          : undefined,
      ),
    );
  if (pairs.length === 0) return;
  await db
    .insert(reviewRequest)
    .values(
      pairs.map((p) => ({
        cycleId,
        participantId: p.participantId,
        reviewerPersonId: p.reviewer,
        relationship: "upward" as const,
        anonymous: anonymousFor(cycle, "upward"),
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

/** The reviewer of a peer/upward draft declines it with a reason. */
export async function declineRequest(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  reason: string,
): Promise<ReviewRequest> {
  return db.transaction(async (tx) => {
    const { request } = await loadRequest(tx, actor, requestId, {
      forUpdate: true,
    });
    if (
      actor.personId === null ||
      actor.personId !== request.reviewerPersonId ||
      (request.relationship !== "peer" && request.relationship !== "upward") ||
      request.status !== "draft"
    ) {
      throw new ReviewError("forbidden");
    }
    const text = reason.trim();
    if (!text) {
      throw new ReviewError("validation", [
        { path: "reason", message: "required" },
      ]);
    }
    const [updated] = await tx
      .update(reviewRequest)
      .set({ status: "declined", declinedAt: new Date(), declineReason: text })
      .where(eq(reviewRequest.id, requestId))
      .returning();
    return updated;
  });
}

/** Phases in which a draft still counts as open work for its reviewer. */
const OPEN_PHASES = {
  // Peer requests approved during nominations are written in collecting.
  peer: ["nominations", ...writablePhases.peer],
  upward: [...writablePhases.upward],
} satisfies Record<"peer" | "upward", CycleStatus[]>;

/**
 * Open (draft) peer/upward requests per reviewer across cycles, counting
 * only drafts their reviewer can still write (writablePhases; peer drafts
 * also while nominations are open): the load counter shown when
 * nominating and approving.
 */
export async function openRequestsCount(
  db: DbOrTx,
  personIds: string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(personIds.filter(isUuid))];
  const result = new Map(ids.map((id) => [id, 0]));
  if (ids.length === 0) return result;
  const rows = await db
    .select({ personId: reviewRequest.reviewerPersonId, n: count() })
    .from(reviewRequest)
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .where(
      and(
        inArray(reviewRequest.reviewerPersonId, ids),
        or(
          and(
            eq(reviewRequest.relationship, "peer"),
            inArray(reviewCycle.status, OPEN_PHASES.peer),
          ),
          and(
            eq(reviewRequest.relationship, "upward"),
            inArray(reviewCycle.status, OPEN_PHASES.upward),
          ),
        ),
        eq(reviewRequest.status, "draft"),
        isNull(reviewRequest.deletedAt),
        isNull(reviewCycle.deletedAt),
      ),
    )
    .groupBy(reviewRequest.reviewerPersonId);
  for (const r of rows) if (r.personId) result.set(r.personId, r.n);
  return result;
}

export type NominationItem = {
  id: string;
  nomineePersonId: string;
  nomineeName: string;
  status: NominationStatus;
  openRequests: number;
  overloaded: boolean;
};

/** Nominations of a participant (reviewee, snapshot manager or HR). */
export async function listNominations(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
): Promise<NominationItem[]> {
  const { participant, cycle } = await participantWithCycle(db, participantId);
  if (
    !isHr(actor) &&
    !isRevieweeOf(actor, participant) &&
    !isManagerOf(actor, participant)
  ) {
    throw new ReviewError("forbidden");
  }
  const rows = await db
    .select({
      id: peerNomination.id,
      nomineePersonId: peerNomination.nomineePersonId,
      nomineeName: person.displayName,
      status: peerNomination.status,
    })
    .from(peerNomination)
    .innerJoin(person, eq(person.id, peerNomination.nomineePersonId))
    .where(eq(peerNomination.participantId, participantId))
    .orderBy(asc(peerNomination.createdAt));
  const load = await openRequestsCount(
    db,
    rows.map((r) => r.nomineePersonId),
  );
  const { loadWarningAt } = peerSettingsOf(cycle.components);
  return rows.map((r) => {
    const openRequests = load.get(r.nomineePersonId) ?? 0;
    return { ...r, openRequests, overloaded: openRequests >= loadWarningAt };
  });
}

export type PendingApproval = {
  id: string;
  cycleId: string;
  cycleName: string;
  participantId: string;
  revieweeName: string;
  nomineeName: string;
  openRequests: number;
  overloaded: boolean;
};

/** Pending nominations the actor decides (their direct reports; HR: all). */
export async function listPendingApprovals(
  db: DbOrTx,
  actor: ActorContext,
  cycleId?: string,
): Promise<PendingApproval[]> {
  if (!isHr(actor) && !actor.personId) return [];
  const reviewee = alias(person, "reviewee");
  const rows = await db
    .select({
      id: peerNomination.id,
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      components: reviewCycle.components,
      participantId: cycleParticipant.id,
      revieweeName: reviewee.displayName,
      nomineePersonId: peerNomination.nomineePersonId,
      nomineeName: person.displayName,
    })
    .from(peerNomination)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, peerNomination.participantId),
    )
    .innerJoin(reviewCycle, eq(reviewCycle.id, peerNomination.cycleId))
    .innerJoin(reviewee, eq(reviewee.id, cycleParticipant.revieweePersonId))
    .innerJoin(person, eq(person.id, peerNomination.nomineePersonId))
    .where(
      and(
        eq(peerNomination.status, "pending"),
        eq(reviewCycle.status, "nominations"),
        isNull(reviewCycle.deletedAt),
        isNull(cycleParticipant.removedAt),
        cycleId && isUuid(cycleId) ? eq(reviewCycle.id, cycleId) : undefined,
        isHr(actor)
          ? undefined
          : eq(cycleParticipant.snapManagerPersonId, actor.personId!),
      ),
    )
    .orderBy(
      asc(reviewCycle.name),
      asc(reviewee.displayName),
      asc(person.displayName),
    );
  const load = await openRequestsCount(
    db,
    rows.map((r) => r.nomineePersonId),
  );
  return rows
    .filter((r) => peerSettingsOf(r.components).approval !== "none")
    .map(({ components, nomineePersonId, ...r }) => {
      const openRequests = load.get(nomineePersonId) ?? 0;
      return {
        ...r,
        openRequests,
        overloaded: openRequests >= peerSettingsOf(components).loadWarningAt,
      };
    });
}

export type NominationCandidate = { personId: string; displayName: string };

export type NominationPicker = {
  participantId: string;
  cycleName: string;
  canEdit: boolean;
  max: number;
  /** 'none': nominations need no approval (the intro says so). */
  approval: PeerApproval;
  loadWarningAt: number;
  nominations: NominationItem[];
  candidates: (NominationCandidate & {
    openRequests: number;
    overloaded: boolean;
  })[];
};

/** What the nomination page needs for the actor's own participation. */
export async function nominationPicker(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<NominationPicker | null> {
  if (!actor.personId || !isUuid(cycleId)) return null;
  const [row] = await db
    .select({ participant: cycleParticipant, cycle: reviewCycle })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        eq(cycleParticipant.revieweePersonId, actor.personId),
        isNull(cycleParticipant.removedAt),
        isNull(reviewCycle.deletedAt),
      ),
    );
  if (!row || !row.cycle.components.peer) return null;
  const { participant, cycle } = row;
  const settings = peerSettingsOf(cycle.components);
  const nominations = await listNominations(db, actor, participant.id);
  const taken = new Set(
    nominations
      .filter((n) => n.status !== "removed")
      .map((n) => n.nomineePersonId),
  );
  const excluded = [
    participant.revieweePersonId,
    ...(participant.snapManagerPersonId
      ? [participant.snapManagerPersonId]
      : []),
    ...taken,
  ];
  const candidates = await db
    .select({ personId: person.id, displayName: person.displayName })
    .from(person)
    .where(and(notInArray(person.id, excluded), isActivePersonSql(person.id)))
    .orderBy(asc(person.displayName));
  const load = await openRequestsCount(
    db,
    candidates.map((c) => c.personId),
  );
  return {
    participantId: participant.id,
    cycleName: cycle.name,
    canEdit: cycle.status === "nominations",
    max: settings.maxNominations,
    approval: settings.approval,
    loadWarningAt: settings.loadWarningAt,
    nominations,
    candidates: candidates.map((c) => {
      const openRequests = load.get(c.personId) ?? 0;
      return {
        ...c,
        openRequests,
        overloaded: openRequests >= settings.loadWarningAt,
      };
    }),
  };
}

export type PeerFeedbackItem = {
  requestId: string;
  relationship: Extract<Relationship, "peer" | "upward">;
  /** Null when the anonymity mode hides the reviewer from the actor. */
  reviewerName: string | null;
  reviewerVisible: boolean;
  questions: Review["questions"];
  answers: Review["answers"];
};

/**
 * Submitted peer/upward feedback about a participant that the actor may
 * read (canRead), with the reviewer's name only when reviewerVisible.
 */
export async function listPeerFeedback(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
): Promise<PeerFeedbackItem[]> {
  if (!isUuid(participantId)) return [];
  const rows = await db
    .select({
      request: reviewRequest,
      participant: cycleParticipant,
      cycle: reviewCycle,
      reviewerName: person.displayName,
    })
    .from(reviewRequest)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .leftJoin(person, eq(person.id, reviewRequest.reviewerPersonId))
    .where(
      and(
        eq(reviewRequest.participantId, participantId),
        inArray(reviewRequest.relationship, ["peer", "upward"]),
        eq(reviewRequest.status, "submitted"),
        isNull(reviewRequest.deletedAt),
        isNull(reviewCycle.deletedAt),
      ),
    )
    .orderBy(asc(reviewRequest.submittedAt));
  if (rows.length === 0) return [];
  const { participant, cycle } = rows[0];
  const revieweeShared = isRevieweeOf(actor, participant)
    ? await peerFeedbackShared(db, rows[0])
    : false;
  const readable = rows.filter((r) => canRead(actor, { ...r, revieweeShared }));
  if (readable.length === 0) return [];
  const questions = await db
    .select()
    .from(questionRevision)
    .where(
      and(
        eq(questionRevision.cycleId, cycle.id),
        arrayOverlaps(questionRevision.appliesTo, ["peer", "upward"]),
      ),
    )
    .orderBy(asc(questionRevision.sort));
  const answers = await db
    .select()
    .from(answer)
    .where(
      inArray(
        answer.requestId,
        readable.map((r) => r.request.id),
      ),
    );
  return readable.map((r) => {
    const ctx = { ...r, revieweeShared };
    const rel = r.request.relationship as "peer" | "upward";
    const qs = questions.filter(
      (q) =>
        q.appliesTo.includes(rel) &&
        canRead(actor, { ...ctx, questionRevision: q }),
    );
    const byId = new Map(qs.map((q) => [q.id, q]));
    const visible = reviewerVisible(actor, ctx);
    return {
      requestId: r.request.id,
      relationship: rel,
      reviewerName: visible ? r.reviewerName : null,
      reviewerVisible: visible,
      questions: qs,
      answers: Object.fromEntries(
        answers
          .filter(
            (a) =>
              a.requestId === r.request.id && byId.has(a.questionRevisionId),
          )
          .map((a) => [
            a.questionRevisionId,
            answerValueOf(byId.get(a.questionRevisionId), a),
          ]),
      ),
    };
  });
}

/** The actor's participant id in a cycle (to read their own feedback). */
export async function findMyParticipantId(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<string | null> {
  if (!actor.personId || !isUuid(cycleId)) return null;
  const [row] = await db
    .select({ id: cycleParticipant.id })
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        eq(cycleParticipant.revieweePersonId, actor.personId),
      ),
    );
  return row?.id ?? null;
}

export type NominationTask = {
  cycleId: string;
  cycleName: string;
  participantId: string;
  dueDate: string | null;
  nominated: number;
  max: number;
};

export type FeedbackTask = {
  requestId: string;
  cycleId: string;
  cycleName: string;
  relationship: "peer" | "upward";
  revieweeName: string;
  dueDate: string | null;
};

/**
 * Cycles in nominations where the actor is a participant: always listed
 * (also at the cap) so the nomination page stays reachable.
 */
export async function nominationTasks(
  db: DbOrTx,
  personId: string,
): Promise<NominationTask[]> {
  const rows = await db
    .select({
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      components: reviewCycle.components,
      participantId: cycleParticipant.id,
      dueDate: sql<string | null>`${reviewCycle.dueDates}->>'nominations'`,
      nominated: sql<number>`(select count(*)::int from ${peerNomination} n
        where n.participant_id = ${cycleParticipant.id}
        and n.status in ('pending', 'approved'))`,
    })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .where(
      and(
        eq(cycleParticipant.revieweePersonId, personId),
        isNull(cycleParticipant.removedAt),
        eq(reviewCycle.status, "nominations"),
        isNull(reviewCycle.deletedAt),
      ),
    )
    .orderBy(asc(reviewCycle.name));
  return rows
    .filter((r) => r.components.peer)
    .map(({ components, ...r }) => ({
      ...r,
      max: peerSettingsOf(components).maxNominations,
    }));
}

/** Draft peer/upward requests the actor has to write. */
export async function feedbackTasks(
  db: DbOrTx,
  personId: string,
): Promise<FeedbackTask[]> {
  const rows = await db
    .select({
      requestId: reviewRequest.id,
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      relationship: reviewRequest.relationship,
      revieweeName: person.displayName,
      dueDate: sql<string | null>`${reviewCycle.dueDates}->>'peer'`,
    })
    .from(reviewRequest)
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .where(
      and(
        eq(reviewRequest.reviewerPersonId, personId),
        or(
          eq(reviewRequest.relationship, "peer"),
          eq(reviewRequest.relationship, "upward"),
        ),
        eq(reviewRequest.status, "draft"),
        isNull(reviewRequest.deletedAt),
        isNull(cycleParticipant.removedAt),
        eq(reviewCycle.status, "collecting"),
        isNull(reviewCycle.deletedAt),
      ),
    )
    .orderBy(asc(reviewCycle.name), asc(person.displayName));
  return rows.map((r) => ({
    ...r,
    relationship: r.relationship as "peer" | "upward",
  }));
}
