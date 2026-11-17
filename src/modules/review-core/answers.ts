import { and, arrayContains, asc, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  answer,
  type Answer,
  type QuestionRevision,
  questionRevision,
  type Relationship,
  type ReviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  goalsQuestionsOptional,
  type GoalsScope,
  isGoalsQuestion,
} from "./goal-snapshot";
import { loadRequest } from "./requests";
import { ReviewError } from "./review-errors";
import type { CycleAnonymity, CycleStatus } from "./status";
import { canRead, isReviewer, reviewerVisible } from "./visibility";

/** Value of an answer as the form handles it (rating: the scale value). */
export type AnswerValue = string | number | null;
export type AnswerInput = { questionRevisionId: string; value: AnswerValue };

export type SelfReview = GoalsScope & {
  request: ReviewRequest;
  cycle: {
    id: string;
    name: string;
    dueDate: string | null;
    anonymity: CycleAnonymity;
    status: CycleStatus;
  };
  questions: QuestionRevision[];
  /** Current answers by question revision id. */
  answers: Record<string, AnswerValue>;
  /**
   * Whether the actor may know who wrote it (peer/upward anonymity); when
   * not, request.reviewerPersonId is null.
   */
  reviewerVisible: boolean;
  /** The actor wrote it (from the raw request, before any anonymizing). */
  isAuthor: boolean;
};

/**
 * The frozen questions a participant answers: those of their template group
 * (`templateGroupId` of the participant row) or, without a group, those of
 * the cycle's default template. `relationship` keeps the ones that apply to
 * it. The single reader of question revisions for every form (self, manager,
 * peer...): a form must never list a cycle's revisions without it.
 */
export const questionsFor = (
  db: DbOrTx,
  cycleId: string,
  templateGroupId: string | null,
  relationship?: Relationship,
) =>
  db
    .select()
    .from(questionRevision)
    .where(
      and(
        eq(questionRevision.cycleId, cycleId),
        templateGroupId
          ? eq(questionRevision.groupId, templateGroupId)
          : isNull(questionRevision.groupId),
        relationship
          ? arrayContains(questionRevision.appliesTo, [relationship])
          : undefined,
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

/** A review of any relationship (questions, answers, writability). */
export type Review = SelfReview;

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
  const { request, cycle, visibility, participant } = row;
  // Without goals to rate, the goals rating and its comment are optional.
  const goalsOptional = await goalsQuestionsOptional(db, request);
  const questions = (
    await questionsFor(
      db,
      cycle.id,
      participant.templateGroupId,
      request.relationship,
    )
  )
    .filter((q) => canRead(actor, { ...visibility, questionRevision: q }))
    .map((q) =>
      goalsOptional && isGoalsQuestion(q) ? { ...q, required: false } : q,
    );
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
    participant: {
      id: row.participant.id,
      revieweePersonId: row.participant.revieweePersonId,
      snapManagerPersonId: row.participant.snapManagerPersonId,
      removedAt: row.participant.removedAt,
    },
    cycle: {
      id: cycle.id,
      name: cycle.name,
      dueDate: cycle.dueDates[duePhase] ?? null,
      anonymity: cycle.anonymity,
      status: cycle.status,
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
  };
}
