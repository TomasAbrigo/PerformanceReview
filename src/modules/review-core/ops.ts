import {
  aliasedTable,
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  type CycleParticipant,
  cycleParticipant,
  person,
  reviewAudit,
  reviewCycle,
  type ReviewCycle,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import { parse } from "@/lib/domain-error";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { todayLocal } from "@/modules/org-history/dates";
import { type IsoDate, jobsAsOf } from "@/modules/org-history/queries";
import {
  type AnswerInput,
  getReview,
  type Review,
  saveDraft,
  submit,
} from "./answers";
import { audit } from "./admin-audit";
import { CyclesError } from "./errors";
import {
  type AssessorMode,
  assessorModes,
  type AuditSnapshot,
} from "./ops-constants";
import { OpsError } from "./ops-errors";
import {
  ensureManagerRequests,
  loadRequest,
  personName,
  unlock,
} from "./requests";
import {
  activeCycle,
  addParticipant,
  listEligiblePeople,
  removeParticipant,
  updateCycle,
} from "./service";
import { type CycleStatus, type DueDatePhase, dueDatePhases } from "./status";
import { canWrite } from "./visibility";

// Administrative operations on a launched cycle (#17). Every operation is HR
// only and runs in one transaction that also writes exactly one
// admin_audit_log row (see ./admin-audit), so a failed action leaves neither
// a change nor a log entry.

const parseOps = <T>(schema: z.ZodType<T>, value: unknown): T =>
  parse(schema, value, OpsError);

function requireHr(actor: ActorContext): void {
  if (actor.role !== "hr") throw new OpsError("forbidden");
}

const notFound = () => new OpsError("not_found");

// ------------------------------------------------------------ participants

const participantState = (p: CycleParticipant): AuditSnapshot => ({
  participantId: p.id,
  personId: p.revieweePersonId,
  snapshotAsOf: p.snapshotAsOf,
  snapManagerPersonId: p.snapManagerPersonId,
  removedAt: p.removedAt?.toISOString() ?? null,
});

const requestStates = async (db: DbOrTx, participantId: string) =>
  (
    await db
      .select({
        requestId: reviewRequest.id,
        relationship: reviewRequest.relationship,
        reviewerPersonId: reviewRequest.reviewerPersonId,
        status: reviewRequest.status,
      })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.participantId, participantId),
          isNull(reviewRequest.deletedAt),
        ),
      )
      .orderBy(asc(reviewRequest.relationship), asc(reviewRequest.requestedAt))
  ).map((r): AuditSnapshot => r);

/**
 * reviewer_mismatch of a participant's manager requests: the primary
 * request has a reviewer and it is not the snapshot manager (also when the
 * snapshot has none; a missing reviewer is flagged by reviewer_missing
 * instead). It is about the primary only: an additional assessor is, by
 * definition, someone else.
 */
async function syncReviewerMismatch(db: DbOrTx, participantId: string) {
  await db.execute(sql`
    update review_request rr
    set reviewer_mismatch = (not rr.additional
        and rr.reviewer_person_id is not null
        and rr.reviewer_person_id is distinct from cp.snap_manager_person_id),
      updated_at = now()
    from cycle_participant cp
    where cp.id = rr.participant_id and rr.participant_id = ${participantId}
      and rr.relationship = 'manager'`);
}

async function findParticipant(
  db: DbOrTx,
  cycleId: string,
  personId: string,
): Promise<CycleParticipant | null> {
  if (!isUuid(cycleId) || !isUuid(personId)) return null;
  const [row] = await db
    .select()
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        eq(cycleParticipant.revieweePersonId, personId),
      ),
    );
  return row ?? null;
}

/**
 * Adds a reviewee to a launched cycle, snapshotting their org data on `asOf`
 * (today by default) and creating their pending requests; audited.
 */
export async function addParticipantOp(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  personId: string,
  opts: { note?: string | null; asOf?: IsoDate } = {},
): Promise<CycleParticipant> {
  requireHr(actor);
  return db.transaction(async (tx) => {
    if (!isUuid(personId) || !(await personName(tx, personId)))
      throw notFound();
    const existing = await findParticipant(tx, cycleId, personId);
    const added = await addParticipant(tx, cycleId, personId, opts.asOf);
    await syncReviewerMismatch(tx, added.id);
    await audit(tx, {
      actorPersonId: actor.personId,
      action: "participant_added",
      targetType: "participant",
      targetId: added.id,
      cycleId,
      before: existing ? participantState(existing) : null,
      after: {
        ...participantState(added),
        personName: await personName(tx, personId),
        requests: await requestStates(tx, added.id),
      },
      note: opts.note,
    });
    return added;
  });
}

/**
 * Removes a reviewee from a launched cycle; audited. The participant row and
 * all their requests and answers stay (history). Decision: pending drafts are
 * left as they are rather than declined: `canWrite` already blocks writing
 * once `removed_at` is set and the task inbox hides them, and re-adding the
 * person resumes them.
 */
export async function removeParticipantOp(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  personId: string,
  opts: { note?: string | null } = {},
): Promise<void> {
  requireHr(actor);
  await db.transaction(async (tx) => {
    const before = await findParticipant(tx, cycleId, personId);
    if (!before || before.removedAt) throw new CyclesError("not_found");
    const openRequests = (await requestStates(tx, before.id)).filter(
      (r) => r.status === "draft",
    );
    await removeParticipant(tx, cycleId, personId);
    const after = (await findParticipant(tx, cycleId, personId))!;
    await audit(tx, {
      actorPersonId: actor.personId,
      action: "participant_removed",
      targetType: "participant",
      targetId: before.id,
      cycleId,
      before: {
        ...participantState(before),
        personName: await personName(tx, personId),
        openRequests,
      },
      after: { ...participantState(after), openRequests },
      note: opts.note,
    });
  });
}

// --------------------------------------------------------------- due dates

const extendInput = z.object({
  phase: z.enum(dueDatePhases),
  date: z.iso.date("invalid_date"),
});

/**
 * Moves the due date of a phase forward (never back); audited. The phase must
 * already have a date (there is nothing to extend otherwise) and the cycle
 * must be launched. updateCycle keeps the phases in order.
 */
export async function extendDueDate(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  phase: DueDatePhase,
  newDate: string,
  opts: { note?: string | null } = {},
): Promise<ReviewCycle> {
  requireHr(actor);
  const input = parseOps(extendInput, { phase, date: newDate });
  return db.transaction(async (tx) => {
    const cycle = await activeCycle(tx, cycleId);
    const current = cycle.dueDates[input.phase];
    if (!current || input.date <= current) {
      throw new OpsError("date_not_forward", [
        { path: input.phase, message: "date_not_forward" },
      ]);
    }
    const updated = await updateCycle(tx, cycleId, {
      dueDates: { ...cycle.dueDates, [input.phase]: input.date },
    });
    await audit(tx, {
      actorPersonId: actor.personId,
      action: "due_date_extended",
      targetType: "cycle",
      targetId: cycleId,
      cycleId,
      before: { phase: input.phase, date: current },
      after: { phase: input.phase, date: input.date },
      note: opts.note,
    });
    return updated;
  });
}

// ------------------------------------------------------------------ unlock

/**
 * HR returns a submitted request to draft (existing `unlock`, which also
 * records the request-level audit); audited here too. Double blind applies
 * again: a draft is unreadable to the other side until it is resubmitted, and
 * an unlocked manager review loses its "shared" mark, so the corrected
 * version is shared again on purpose.
 */
export async function unlockRequestOp(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  note: string | null = null,
): Promise<ReviewRequest> {
  requireHr(actor);
  return db.transaction(async (tx) => {
    const before = isUuid(requestId)
      ? (
          await tx
            .select()
            .from(reviewRequest)
            .where(eq(reviewRequest.id, requestId))
        )[0]
      : undefined;
    if (!before) throw notFound();
    await unlock(tx, actor, requestId, note);
    if (before.relationship === "manager" && before.sharedAt) {
      await tx
        .update(reviewRequest)
        .set({ sharedAt: null, sharedBy: null })
        .where(eq(reviewRequest.id, requestId));
    }
    const [after] = await tx
      .select()
      .from(reviewRequest)
      .where(eq(reviewRequest.id, requestId));
    await audit(tx, {
      actorPersonId: actor.personId,
      action: "request_unlocked",
      targetType: "request",
      targetId: requestId,
      cycleId: before.cycleId,
      before: {
        status: before.status,
        submittedAt: before.submittedAt?.toISOString() ?? null,
        sharedAt: before.sharedAt?.toISOString() ?? null,
      },
      after: {
        status: after.status,
        submittedAt: null,
        sharedAt: after.sharedAt?.toISOString() ?? null,
      },
      note,
    });
    return after;
  });
}

// ------------------------------------------------------- complete on behalf

const reviewerActor = (request: ReviewRequest): ActorContext => ({
  personId: request.reviewerPersonId,
  role: request.relationship === "self" ? "employee" : "manager",
});

/** HR may complete it now: a draft its reviewer could write in this phase. */
const canCompleteOnBehalf = (
  request: ReviewRequest,
  scope: Parameters<typeof canWrite>[2],
) =>
  request.reviewerPersonId !== null &&
  canWrite(reviewerActor(request), request, scope);

export type OnBehalfReview = {
  review: Review;
  revieweeName: string | null;
  reviewerName: string | null;
  canComplete: boolean;
};

/**
 * What HR needs to complete a review on behalf of its reviewer (HR only):
 * the review as HR reads it (questions and current answers), who is who and
 * whether it can be completed now. Null when the request is not found.
 */
export async function getOnBehalfReview(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<OnBehalfReview | null> {
  requireHr(actor);
  // One load: the review already carries the request, participant and phase.
  const review = await getReview(db, actor, requestId);
  if (!review) return null;
  const { request, participant } = review;
  const [revieweeName, reviewerName] = await Promise.all([
    personName(db, participant.revieweePersonId),
    personName(db, request.reviewerPersonId),
  ]);
  return {
    review,
    revieweeName,
    reviewerName,
    canComplete: canCompleteOnBehalf(request, review),
  };
}

/**
 * HR saves `answers` and submits a draft as its reviewer (marking it
 * submitted_on_behalf), to unblock a review; audited with the answers before
 * and after. To edit an already submitted review, unlock it first. Fails like
 * the reviewer would: incomplete required answers, a phase where the review
 * cannot be written, a removed participant. A request without reviewer needs
 * an assessor first (assignAlternateAssessor).
 */
export async function completeOnBehalf(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  answers: AnswerInput[],
  opts: { note?: string | null } = {},
): Promise<ReviewRequest> {
  requireHr(actor);
  return db.transaction(async (tx) => {
    const loaded = await loadRequest(tx, actor, requestId, { forUpdate: true });
    const { request } = loaded;
    if (!request.reviewerPersonId) throw new OpsError("reviewer_missing");
    if (request.status !== "draft") throw new OpsError("not_draft");
    if (!canCompleteOnBehalf(request, loaded)) {
      throw new OpsError("not_writable");
    }
    const asReviewer = reviewerActor(request);
    const answersBefore = (await getReview(tx, actor, requestId))!.answers;
    await saveDraft(tx, asReviewer, requestId, answers);
    await submit(tx, asReviewer, requestId);
    const [updated] = await tx
      .update(reviewRequest)
      .set({ submittedOnBehalf: true, submittedOnBehalfBy: actor.personId })
      .where(eq(reviewRequest.id, requestId))
      .returning();
    const answersAfter = (await getReview(tx, actor, requestId))!.answers;
    await audit(tx, {
      actorPersonId: actor.personId,
      action: "completed_on_behalf",
      targetType: "request",
      targetId: requestId,
      cycleId: request.cycleId,
      before: {
        status: request.status,
        reviewerPersonId: request.reviewerPersonId,
        reviewerName: await personName(tx, request.reviewerPersonId),
        answers: answersBefore,
      },
      after: {
        status: updated.status,
        submittedOnBehalf: true,
        answers: answersAfter,
      },
      note: opts.note,
    });
    return updated;
  });
}

// -------------------------------------------------------- alternate assessor

const assessorInput = z.object({ mode: z.enum(assessorModes) });

/**
 * Assigns another reviewer to a participant's manager review (manager on
 * leave, dotted line, a CEO without manager); audited.
 *
 * - `replace`: the primary manager request goes to `personId`. A draft moves
 *   with its answers; a submitted (or declined) one is kept as `superseded`
 *   history and a new draft is created. A participant without manager must
 *   be given an assessor this way.
 * - `additional`: a second manager request for `personId`, next to the first.
 *
 * reviewer_mismatch is set when the reviewer differs from the snapshot
 * manager. Returns the resulting (moved, created or revived) request.
 */
export async function assignAlternateAssessor(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  personId: string,
  mode: AssessorMode,
  opts: { note?: string | null } = {},
): Promise<ReviewRequest> {
  requireHr(actor);
  parseOps(assessorInput, { mode });
  return db.transaction(async (tx) => {
    const [participant] = isUuid(participantId)
      ? await tx
          .select()
          .from(cycleParticipant)
          .where(
            and(
              eq(cycleParticipant.id, participantId),
              isNull(cycleParticipant.removedAt),
            ),
          )
      : [];
    if (
      !participant ||
      !isUuid(personId) ||
      !(await personName(tx, personId))
    ) {
      throw notFound();
    }
    await activeCycle(tx, participant.cycleId);
    await ensureManagerRequests(tx, participant.cycleId, participant.id);
    const requests = await tx
      .select()
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.participantId, participant.id),
          eq(reviewRequest.relationship, "manager"),
          isNull(reviewRequest.deletedAt),
        ),
      )
      .orderBy(asc(reviewRequest.requestedAt), asc(reviewRequest.id));
    const active = requests.filter((r) => r.status !== "superseded");
    const primary = active.find((r) => !r.additional);
    if (!primary) throw new OpsError("no_manager_request");
    const target = requests.find((r) => r.reviewerPersonId === personId);
    if (target && target.status !== "superseded") {
      throw new OpsError(
        target.id === primary.id ? "same_reviewer" : "already_assigned",
      );
    }
    if (mode === "additional" && primary.reviewerPersonId === null) {
      throw new OpsError("replace_required");
    }

    const before = await assessorState(tx, primary, active);
    let result: ReviewRequest;
    let supersededRequestId: string | null = null;
    // Bringing a superseded request back restores what its reviewer wrote
    // (submitted, or a draft), but not what happened around it: it is not
    // shared with the employee again by itself, and a decline is forgotten.
    const revive = (r: ReviewRequest, additional: boolean) =>
      tx
        .update(reviewRequest)
        .set({
          status: r.submittedAt ? "submitted" : "draft",
          additional,
          assignedByHr: true,
          reviewerMissing: false,
          sharedAt: null,
          sharedBy: null,
          declinedAt: null,
          declineReason: null,
        })
        .where(eq(reviewRequest.id, r.id))
        .returning();
    const supersede = async (r: ReviewRequest) => {
      await tx
        .update(reviewRequest)
        .set({ status: "superseded" })
        .where(eq(reviewRequest.id, r.id));
      supersededRequestId = r.id;
    };

    if (mode === "additional") {
      [result] = target
        ? await revive(target, true)
        : await tx
            .insert(reviewRequest)
            .values({
              cycleId: participant.cycleId,
              participantId: participant.id,
              reviewerPersonId: personId,
              relationship: "manager",
              additional: true,
              assignedByHr: true,
            })
            .returning();
    } else if (target) {
      [result] = await revive(target, false);
      await supersede(primary);
    } else if (primary.status === "draft") {
      [result] = await tx
        .update(reviewRequest)
        .set({
          reviewerPersonId: personId,
          reviewerMissing: false,
          assignedByHr: true,
        })
        .where(eq(reviewRequest.id, primary.id))
        .returning();
    } else {
      [result] = await tx
        .insert(reviewRequest)
        .values({
          cycleId: participant.cycleId,
          participantId: participant.id,
          reviewerPersonId: personId,
          relationship: "manager",
          assignedByHr: true,
        })
        .returning();
      await supersede(primary);
    }
    if (mode === "replace") {
      // Same request-level trail as ensureManagerRequests' reassignment
      // (note: who had the review).
      await tx.insert(reviewAudit).values({
        requestId: result.id,
        action: "reviewer_reassigned",
        actorPersonId: actor.personId,
        note: primary.reviewerPersonId,
      });
    }
    await syncReviewerMismatch(tx, participant.id);
    const [fresh] = await tx
      .select()
      .from(reviewRequest)
      .where(eq(reviewRequest.id, result.id));
    const stillActive = await tx
      .select()
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.participantId, participant.id),
          eq(reviewRequest.relationship, "manager"),
          isNull(reviewRequest.deletedAt),
          ne(reviewRequest.status, "superseded"),
        ),
      );
    await audit(tx, {
      actorPersonId: actor.personId,
      action: "assessor_assigned",
      targetType: "participant",
      targetId: participant.id,
      cycleId: participant.cycleId,
      before,
      after: {
        mode,
        ...(await assessorState(tx, fresh, stillActive)),
        reviewerMismatch: fresh.reviewerMismatch,
        supersededRequestId,
      },
      note: opts.note,
    });
    return fresh;
  });
}

/** The request being changed plus who reviews the participant's manager review. */
async function assessorState(
  db: DbOrTx,
  request: ReviewRequest,
  active: ReviewRequest[],
): Promise<AuditSnapshot> {
  return {
    requestId: request.id,
    status: request.status,
    reviewerPersonId: request.reviewerPersonId,
    reviewerName: await personName(db, request.reviewerPersonId),
    reviewerMissing: request.reviewerMissing,
    assessorIds: active.map((r) => r.reviewerPersonId),
  };
}

// ----------------------------------------------------------- manager changes

export type ManagerChangeAction =
  /** Move the manager review (a draft, or a declined one) to the current manager. */
  | "reassign"
  /** Keep the submitted review and add the current manager as assessor. */
  | "add_assessor"
  /** Nothing to do (already handled, or nobody to propose). */
  | "none";

export type ManagerChange = {
  participantId: string;
  revieweePersonId: string;
  revieweeName: string;
  snapshotManagerId: string | null;
  snapshotManagerName: string | null;
  currentManagerId: string | null;
  currentManagerName: string | null;
  /** The primary manager request (null before the cycle collects). */
  requestId: string | null;
  requestStatus: ReviewRequest["status"] | null;
  /** Who is actually writing it (null: nobody yet). */
  reviewerId: string | null;
  reviewerName: string | null;
  /** Some manager request's reviewer differs from the snapshot manager. */
  reviewerMismatch: boolean;
  suggestedAction: ManagerChangeAction;
};

/**
 * Active participants whose manager on `asOf` (today by default, from the
 * org history) differs from their snapshot manager, with the actual reviewer
 * of their manager review, the persisted reviewer_mismatch flag and a
 * suggested action. Read-only: assignAlternateAssessor acts on it. People
 * without a job row that day (left, not hired) are not listed.
 */
export async function detectManagerChanges(
  db: DbOrTx,
  cycleId: string,
  asOf: IsoDate = todayLocal(),
): Promise<ManagerChange[]> {
  if (!isUuid(cycleId)) return [];
  const reviewee = aliasedTable(person, "reviewee");
  const rows = await db
    .select({ participant: cycleParticipant, name: reviewee.displayName })
    .from(cycleParticipant)
    .innerJoin(reviewee, eq(reviewee.id, cycleParticipant.revieweePersonId))
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        isNull(cycleParticipant.removedAt),
      ),
    )
    .orderBy(asc(reviewee.displayName));
  const jobs = await jobsAsOf(
    db,
    rows.map((r) => r.participant.revieweePersonId),
    asOf,
  );
  const changed = rows.filter(({ participant: p }) => {
    const job = jobs.get(p.revieweePersonId);
    return !!job && (job.managerPersonId ?? null) !== p.snapManagerPersonId;
  });
  if (changed.length === 0) return [];

  const requests = await db
    .select()
    .from(reviewRequest)
    .where(
      and(
        inArray(
          reviewRequest.participantId,
          changed.map((r) => r.participant.id),
        ),
        eq(reviewRequest.relationship, "manager"),
        isNull(reviewRequest.deletedAt),
        ne(reviewRequest.status, "superseded"),
      ),
    )
    .orderBy(asc(reviewRequest.requestedAt), asc(reviewRequest.id));
  const ids = new Set<string>();
  for (const { participant: p } of changed) {
    for (const id of [
      p.snapManagerPersonId,
      jobs.get(p.revieweePersonId)?.managerPersonId,
    ]) {
      if (id) ids.add(id);
    }
  }
  for (const r of requests) if (r.reviewerPersonId) ids.add(r.reviewerPersonId);
  const names = new Map(
    ids.size
      ? (
          await db
            .select({ id: person.id, name: person.displayName })
            .from(person)
            .where(inArray(person.id, [...ids]))
        ).map((p) => [p.id, p.name])
      : [],
  );
  const name = (id: string | null | undefined) => (id && names.get(id)) || null;

  return changed.map(({ participant: p, name: revieweeName }) => {
    const mine = requests.filter((r) => r.participantId === p.id);
    const primary = mine.find((r) => !r.additional) ?? null;
    const currentId = jobs.get(p.revieweePersonId)?.managerPersonId ?? null;
    const handled = mine.some((r) => r.reviewerPersonId === currentId);
    const suggestedAction: ManagerChangeAction =
      !primary || !currentId || handled
        ? "none"
        : primary.status === "submitted"
          ? "add_assessor"
          : "reassign";
    return {
      participantId: p.id,
      revieweePersonId: p.revieweePersonId,
      revieweeName,
      snapshotManagerId: p.snapManagerPersonId,
      snapshotManagerName: name(p.snapManagerPersonId),
      currentManagerId: currentId,
      currentManagerName: name(currentId),
      requestId: primary?.id ?? null,
      requestStatus: primary?.status ?? null,
      reviewerId: primary?.reviewerPersonId ?? null,
      reviewerName: name(primary?.reviewerPersonId),
      reviewerMismatch: mine.some((r) => r.reviewerMismatch),
      suggestedAction,
    };
  });
}

// ----------------------------------------------------------------- overview

export type OpsRequestItem = {
  id: string;
  relationship: ReviewRequest["relationship"];
  status: ReviewRequest["status"];
  reviewerPersonId: string | null;
  reviewerName: string | null;
  reviewerMissing: boolean;
  reviewerMismatch: boolean;
  additional: boolean;
  submittedOnBehalf: boolean;
  /** HR may complete it on behalf now (a draft its reviewer could write). */
  canComplete: boolean;
};

export type OpsParticipantItem = {
  participantId: string;
  personId: string;
  displayName: string;
  removed: boolean;
  snapManagerName: string | null;
  snapDepartment: string | null;
  requests: OpsRequestItem[];
  change: ManagerChange | null;
};

export type CycleOps = {
  cycle: {
    id: string;
    name: string;
    status: CycleStatus;
    dueDates: ReviewCycle["dueDates"];
  };
  participants: OpsParticipantItem[];
  /** People who can be added now (not active participants). */
  candidates: { id: string; displayName: string }[];
  /** People who can be assigned as assessors. */
  people: { id: string; displayName: string }[];
};

/** Id and name of a cycle, for pages that only need its header (null: unknown). */
export async function getCycleRef(
  db: DbOrTx,
  cycleId: string,
): Promise<{ id: string; name: string } | null> {
  if (!isUuid(cycleId)) return null;
  const [cycle] = await db
    .select({ id: reviewCycle.id, name: reviewCycle.name })
    .from(reviewCycle)
    .where(and(eq(reviewCycle.id, cycleId), isNull(reviewCycle.deletedAt)));
  return cycle ?? null;
}

/** Everything the participants page needs (HR only); null for an unknown cycle. */
export async function getCycleOps(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
): Promise<CycleOps | null> {
  requireHr(actor);
  if (!isUuid(cycleId)) return null;
  const [cycle] = await db
    .select()
    .from(reviewCycle)
    .where(and(eq(reviewCycle.id, cycleId), isNull(reviewCycle.deletedAt)));
  if (!cycle) return null;
  const reviewee = aliasedTable(person, "reviewee");
  const manager = aliasedTable(person, "manager");
  const rows: {
    participant: CycleParticipant;
    name: string;
    managerName: string | null;
  }[] = await db
    .select({
      participant: cycleParticipant,
      name: reviewee.displayName,
      managerName: manager.displayName,
    })
    .from(cycleParticipant)
    .innerJoin(reviewee, eq(reviewee.id, cycleParticipant.revieweePersonId))
    .leftJoin(manager, eq(manager.id, cycleParticipant.snapManagerPersonId))
    .where(eq(cycleParticipant.cycleId, cycleId))
    .orderBy(asc(reviewee.displayName));
  const reviewer = aliasedTable(person, "reviewer");
  const requests = await db
    .select({ request: reviewRequest, reviewerName: reviewer.displayName })
    .from(reviewRequest)
    .leftJoin(reviewer, eq(reviewer.id, reviewRequest.reviewerPersonId))
    .where(
      and(eq(reviewRequest.cycleId, cycleId), isNull(reviewRequest.deletedAt)),
    )
    .orderBy(asc(reviewRequest.relationship), asc(reviewRequest.requestedAt));
  const changes = new Map(
    (await detectManagerChanges(db, cycleId)).map((c) => [c.participantId, c]),
  );
  const people = await listEligiblePeople(db);
  const active = new Set(
    rows
      .filter((r) => !r.participant.removedAt)
      .map((r) => r.participant.revieweePersonId),
  );
  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      status: cycle.status,
      dueDates: cycle.dueDates,
    },
    participants: rows.map(({ participant: p, name, managerName }) => ({
      participantId: p.id,
      personId: p.revieweePersonId,
      displayName: name,
      removed: !!p.removedAt,
      snapManagerName: managerName,
      snapDepartment: p.snapDepartment,
      change: changes.get(p.id) ?? null,
      requests: requests
        .filter((r) => r.request.participantId === p.id)
        .map(({ request, reviewerName }) => ({
          id: request.id,
          relationship: request.relationship,
          status: request.status,
          reviewerPersonId: request.reviewerPersonId,
          reviewerName,
          reviewerMissing: request.reviewerMissing,
          reviewerMismatch: request.reviewerMismatch,
          additional: request.additional,
          submittedOnBehalf: request.submittedOnBehalf,
          canComplete: canCompleteOnBehalf(request, { cycle, participant: p }),
        })),
    })),
    candidates: people.filter((p) => !active.has(p.id)),
    people,
  };
}
