import { and, arrayContains, asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  type Answer,
  type QuestionRevision,
  questionRevision,
  reviewRequest,
  type ReviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { loadRequest } from "./requests";
import { ReviewError } from "./review-errors";
import type { CycleAnonymity } from "./status";
import { canRead, canWrite, isReviewer, reviewerVisible } from "./visibility";

/** Value of an answer as the form handles it (rating: the scale value). */
export type AnswerValue = string | number | null;
export type AnswerInput = { questionRevisionId: string; value: AnswerValue };

export type SelfReview = {
  request: ReviewRequest;
  cycle: {
    id: string;
    name: string;
    dueDate: string | null;
    anonymity: CycleAnonymity;
  };
  questions: QuestionRevision[];
  /** Current answers by question revision id. */
  answers: Record<string, AnswerValue>;
  canWrite: boolean;
  /**
   * Whether the actor may know who wrote it (peer/upward anonymity); when
   * not, request.reviewerPersonId is null.
   */
  reviewerVisible: boolean;
  /** The actor wrote it (from the raw request, before any anonymizing). */
  isAuthor: boolean;
};

const questionsFor = (
  db: DbOrTx,
  cycleId: string,
  relationship: ReviewRequest["relationship"],
) =>
  db
    .select()
    .from(questionRevision)
    .where(
      and(
        eq(questionRevision.cycleId, cycleId),
        arrayContains(questionRevision.appliesTo, [relationship]),
      ),
    )
    .orderBy(asc(questionRevision.sort));

export function answerValueOf(
  q: QuestionRevision | undefined,
  a: Answer,
): AnswerValue {
  if (q?.kind === "rating") return a.optionValue;
  if (q?.kind === "single_choice") return a.optionLabel;
  return a.textValue;
}

const isEmpty = (v: AnswerValue) =>
  v === null || (typeof v === "string" && v.trim() === "");

/** A review of any relationship (questions, answers, writability). */
export type Review = SelfReview;

/** A self review with its questions and answers; null when not visible. */
export async function getSelfReview(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<SelfReview | null> {
  return getReview(db, actor, requestId);
}

/**
 * A review (self, manager, ...) with the questions and answers the actor may
 * read (canRead per question: e.g. the reviewee only sees the questions
 * visible to them); null when the request is not visible at all.
 */
export async function getReview(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<Review | null> {
  let row;
  try {
    row = await loadRequest(db, actor, requestId);
  } catch (error) {
    if (error instanceof ReviewError) return null;
    throw error;
  }
  const { request, cycle, visibility } = row;
  const questions = (
    await questionsFor(db, cycle.id, request.relationship)
  ).filter((q) => canRead(actor, { ...visibility, questionRevision: q }));
  const rows = await db
    .select()
    .from(answer)
    .where(eq(answer.requestId, request.id));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const duePhase =
    request.relationship === "manager"
      ? "manager"
      : request.relationship === "self"
        ? "self"
        : "peer";
  const showReviewer = reviewerVisible(actor, visibility);
  return {
    request: showReviewer ? request : { ...request, reviewerPersonId: null },
    reviewerVisible: showReviewer,
    isAuthor: isReviewer(actor, request),
    cycle: {
      id: cycle.id,
      name: cycle.name,
      dueDate: cycle.dueDates[duePhase] ?? null,
      anonymity: cycle.anonymity,
    },
    questions,
    answers: Object.fromEntries(
      rows
        .filter((a) => byId.has(a.questionRevisionId))
        .map((a) => [
          a.questionRevisionId,
          answerValueOf(byId.get(a.questionRevisionId), a),
        ]),
    ),
    canWrite: canWrite(actor, request, row),
  };
}

/** Columns to store for a value, validated against the question. */
function columns(q: QuestionRevision, value: AnswerValue) {
  const none = {
    optionValue: null,
    optionLabel: null,
    normalized: null,
    textValue: null,
  };
  const invalid = () =>
    new ReviewError("validation", [{ path: q.id, message: "invalid" }]);
  if (q.kind === "rating") {
    const option = q.scale?.options.find((o) => o.value === Number(value));
    if (!option) throw invalid();
    return {
      ...none,
      optionValue: option.value,
      optionLabel: option.label.es,
      normalized: option.normalized,
    };
  }
  if (q.kind === "single_choice") {
    const choice = q.choices?.find((c) => c.value === String(value));
    if (!choice) throw invalid();
    return { ...none, optionLabel: choice.value };
  }
  if (typeof value !== "string") throw invalid();
  return { ...none, textValue: value };
}

async function writable(db: DbOrTx, actor: ActorContext, requestId: string) {
  const row = await loadRequest(db, actor, requestId, { forUpdate: true });
  if (!canWrite(actor, row.request, row)) throw new ReviewError("forbidden");
  return row;
}

/**
 * Upserts answers of a draft (autosave). Empty values clear the answer. The
 * request stays in draft.
 */
export async function saveDraft(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  answers: AnswerInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const { request, cycle } = await writable(tx, actor, requestId);
    const questions = new Map(
      (await questionsFor(tx, cycle.id, request.relationship)).map((q) => [
        q.id,
        q,
      ]),
    );
    const clear: string[] = [];
    const upserts = [];
    for (const a of answers) {
      const q = questions.get(a.questionRevisionId);
      if (!q) {
        throw new ReviewError("validation", [
          { path: a.questionRevisionId, message: "invalid" },
        ]);
      }
      if (isEmpty(a.value)) clear.push(q.id);
      else
        upserts.push({
          requestId,
          questionRevisionId: q.id,
          ...columns(q, a.value),
        });
    }
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
    for (const values of upserts) {
      await tx
        .insert(answer)
        .values(values)
        .onConflictDoUpdate({
          target: [answer.requestId, answer.questionRevisionId],
          set: { ...values, updatedAt: new Date() },
        });
    }
  });
}

/** Submits a draft: every required question must be answered. Final. */
export async function submit(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<ReviewRequest> {
  return db.transaction(async (tx) => {
    const { request, cycle } = await writable(tx, actor, requestId);
    const questions = await questionsFor(tx, cycle.id, request.relationship);
    const answered = new Set(
      (
        await tx
          .select({ q: answer.questionRevisionId })
          .from(answer)
          .where(eq(answer.requestId, requestId))
      ).map((r) => r.q),
    );
    const missing = questions.filter((q) => q.required && !answered.has(q.id));
    if (missing.length) {
      throw new ReviewError(
        "missing_required",
        missing.map((q) => ({ path: q.id, message: "required" })),
      );
    }
    const [updated] = await tx
      .update(reviewRequest)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(eq(reviewRequest.id, requestId))
      .returning();
    return updated;
  });
}
