import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  cycleParticipant,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { questionsFor } from "@/modules/review-core/answers";
import {
  goalsQuestionsOptional,
  isGoalsQuestion,
} from "@/modules/review-core/goal-snapshot";
import { CaptureError } from "./errors";
import {
  type CaptureAnswer,
  type CaptureQuestion,
  canAnswer,
  checkAnswers,
  missingRequired,
} from "./rules";

/**
 * The request to write, checked: it exists, the actor may answer it and its
 * cycle is still open. Locks the row so concurrent saves and submits queue.
 */
async function loadWritable(db: DbOrTx, actor: ActorContext, id: string) {
  if (!isUuid(id)) throw new CaptureError("not_found");
  const [row] = await db
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
    .where(and(eq(reviewRequest.id, id), isNull(reviewRequest.deletedAt)))
    .for("update", { of: reviewRequest });
  if (!row || row.cycle.deletedAt) throw new CaptureError("not_found");
  if (!canAnswer(actor, row.request)) throw new CaptureError("forbidden");
  if (row.cycle.status === "closed") throw new CaptureError("cycle_closed");
  return row;
}

type Writable = Awaited<ReturnType<typeof loadWritable>>;

/** The questions of the request's form (goals ones optional without goals). */
async function formQuestions(
  db: DbOrTx,
  { request, participant }: Writable,
): Promise<CaptureQuestion[]> {
  const optional = await goalsQuestionsOptional(db, request);
  return (
    await questionsFor(
      db,
      request.cycleId,
      participant.templateGroupId,
      request.relationship,
    )
  ).map((q) =>
    optional && isGoalsQuestion(q) ? { ...q, required: false } : q,
  );
}

const editable = (row: Writable) => {
  if (row.request.status !== "draft") throw new CaptureError("not_editable");
};

/**
 * Saves answers of a draft request (only the ones sent; a blank value clears
 * its answer). Validates each against its question (scale value, choice, the
 * question belongs to the form); required ones are checked on submit. All or
 * nothing: one invalid answer writes none.
 */
export async function saveDraft(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  answers: CaptureAnswer[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadWritable(tx, actor, requestId);
    editable(row);
    const { rows, clear, issues } = checkAnswers(
      await formQuestions(tx, row),
      answers,
    );
    if (issues.length) throw new CaptureError("validation", issues);
    if (clear.length) {
      await tx
        .delete(answer)
        .where(
          and(
            eq(answer.requestId, requestId),
            inArray(answer.questionRevisionId, clear),
          ),
        );
    }
    for (const values of rows) {
      await tx
        .insert(answer)
        .values({ requestId, ...values })
        .onConflictDoUpdate({
          target: [answer.requestId, answer.questionRevisionId],
          set: values,
        });
    }
  });
}

/**
 * Submits a draft request: refuses (code `validation`, one `required` issue
 * per question) while a required question is unanswered. Read-only from then.
 */
export async function submit(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await loadWritable(tx, actor, requestId);
    editable(row);
    const stored = await tx
      .select({ id: answer.questionRevisionId })
      .from(answer)
      .where(eq(answer.requestId, requestId));
    const issues = missingRequired(
      await formQuestions(tx, row),
      new Set(stored.map((a) => a.id)),
    );
    if (issues.length) throw new CaptureError("validation", issues);
    await tx
      .update(reviewRequest)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(eq(reviewRequest.id, requestId));
  });
}

/**
 * Shares a submitted manager review with the reviewee (sets shared_at; the
 * reviewee reads it from then, see canRead). Sharing again keeps the date.
 */
export async function share(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const { request } = await loadWritable(tx, actor, requestId);
    if (request.relationship !== "manager") {
      throw new CaptureError("not_shareable");
    }
    if (request.status !== "submitted") {
      throw new CaptureError("not_submitted");
    }
    if (request.sharedAt) return;
    await tx
      .update(reviewRequest)
      .set({ sharedAt: new Date() })
      .where(eq(reviewRequest.id, requestId));
  });
}

export type PendingSelfReview = {
  requestId: string;
  cycleId: string;
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
};

/**
 * The actor's own self reviews still to write: draft requests they review, of
 * cycles not closed, while they are still a participant. Latest period first.
 */
export async function listPendingSelfReviews(
  db: DbOrTx,
  actor: ActorContext,
): Promise<PendingSelfReview[]> {
  if (actor.personId === null || actor.role === "direction") return [];
  const rows = await db
    .select({
      requestId: reviewRequest.id,
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      periodStart: reviewCycle.periodStart,
      periodEnd: reviewCycle.periodEnd,
      dueDates: reviewCycle.dueDates,
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
        isNull(reviewCycle.deletedAt),
        ne(reviewCycle.status, "closed"),
        isNull(cycleParticipant.removedAt),
      ),
    )
    .orderBy(desc(reviewCycle.periodEnd), asc(reviewCycle.name));
  return rows.map(({ dueDates, ...r }) => ({
    ...r,
    dueDate: dueDates.self ?? null,
  }));
}
