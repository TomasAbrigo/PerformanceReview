import type { DbOrTx } from "@/db/client";
import type { QuestionRevision } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { type AnswerValue, getReview } from "./answers";
import {
  isManagerSideOf,
  isRevieweeOf,
  isShared,
  isSkipLevelOf,
  loadParticipantScope,
} from "./participant-scope";
import { ReviewError } from "./review-errors";

/** One side of a row: the answer (null value: left unanswered). */
export type CompareSide = {
  value: AnswerValue;
  /** Rating: 0-1 value from the scale snapshot; null otherwise or unanswered. */
  normalized: number | null;
};

export type CompareQuestion = Pick<
  QuestionRevision,
  | "id"
  | "sectionTitle"
  | "prompt"
  | "kind"
  | "scale"
  | "choices"
  | "visibleToReviewee"
  | "required"
  | "sort"
>;

export type CompareRow = {
  question: CompareQuestion;
  /** Null when the question is not asked in the self assessment. */
  self: CompareSide | null;
  /** Null when the question is not asked in the manager review. */
  manager: CompareSide | null;
  /**
   * Manager minus self (positive: the manager rated higher), only on rating
   * questions answered on both sides: the scale value and the 0-1 value.
   */
  delta: { numeric: number; normalized: number } | null;
};

export type Comparison = {
  participantId: string;
  cycleId: string;
  cycleName: string;
  revieweeName: string;
  sharedAt: Date | null;
  /** Rows were limited to the questions visible to the employee. */
  employeeView: boolean;
  rows: CompareRow[];
};

const normalizedOf = (q: QuestionRevision, value: AnswerValue) =>
  q.kind === "rating" && value !== null
    ? (q.scale?.options.find((o) => o.value === Number(value))?.normalized ??
      null)
    : null;

function side(
  q: QuestionRevision,
  asked: Set<string>,
  answers: Record<string, AnswerValue>,
): CompareSide | null {
  if (!asked.has(q.id)) return null;
  const value = answers[q.id] ?? null;
  return { value, normalized: normalizedOf(q, value) };
}

/**
 * Self assessment and manager review of a participant side by side, per
 * question revision (a question asked to both shows both answers; one asked
 * to a single side shows the other as not asked). Ratings carry the delta.
 *
 * Only when both reviews are submitted, and only what the actor may read
 * (canRead per question, via getReview): the employee compares once the
 * manager review is shared and only sees the questions visible to them.
 * `employeeView` limits the rows to the questions visible to the employee
 * (the manager screen-sharing the comparison); it is always on for the
 * employee themselves.
 *
 * Errors: not_found (no participant, or the cycle has no self/manager
 * request), forbidden (not involved, or the employee before sharing),
 * not_submitted (an involved actor, but a review is still a draft).
 */
export async function compareReviews(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  options: { employeeView?: boolean } = {},
): Promise<Comparison> {
  const scope = await loadParticipantScope(db, participantId);
  const { selfRequest, managerRequest } = scope;
  if (!selfRequest || !managerRequest) throw new ReviewError("not_found");

  const reviewee = isRevieweeOf(actor, scope) && actor.role !== "hr";
  // The employee always sees the employee view (what their manager hid stays
  // hidden on both sides of the row).
  const employeeView = options.employeeView === true || reviewee;
  const involved =
    actor.role === "hr" ||
    isRevieweeOf(actor, scope) ||
    isManagerSideOf(actor, scope) ||
    (await isSkipLevelOf(db, actor, scope));
  if (!involved) throw new ReviewError("forbidden");
  // The employee never learns about a manager review that is not shared.
  if (reviewee && !isShared(scope)) {
    throw new ReviewError("forbidden");
  }
  if (
    selfRequest.status !== "submitted" ||
    managerRequest.status !== "submitted"
  ) {
    throw new ReviewError("not_submitted");
  }

  const [self, manager] = await Promise.all([
    getReview(db, actor, selfRequest.id),
    getReview(db, actor, managerRequest.id),
  ]);
  if (!self || !manager) throw new ReviewError("forbidden");

  const selfAsked = new Set(self.questions.map((q) => q.id));
  const managerAsked = new Set(manager.questions.map((q) => q.id));
  const questions = new Map<string, QuestionRevision>();
  for (const q of [...self.questions, ...manager.questions]) {
    questions.set(q.id, q);
  }

  const rows = [...questions.values()]
    .sort((a, b) => a.sort - b.sort)
    .filter((q) => !employeeView || q.visibleToReviewee)
    .map((q): CompareRow => {
      const selfSide = side(q, selfAsked, self.answers);
      const managerSide = side(q, managerAsked, manager.answers);
      const rated =
        q.kind === "rating" &&
        selfSide?.normalized != null &&
        managerSide?.normalized != null;
      return {
        question: {
          id: q.id,
          sectionTitle: q.sectionTitle,
          prompt: q.prompt,
          kind: q.kind,
          scale: q.scale,
          choices: q.choices,
          visibleToReviewee: q.visibleToReviewee,
          required: q.required,
          sort: q.sort,
        },
        self: selfSide,
        manager: managerSide,
        delta: rated
          ? {
              numeric: Number(managerSide.value) - Number(selfSide.value),
              normalized: managerSide.normalized! - selfSide.normalized!,
            }
          : null,
      };
    });

  return {
    participantId,
    cycleId: scope.cycle.id,
    cycleName: scope.cycle.name,
    revieweeName: scope.revieweeName,
    sharedAt: managerRequest.sharedAt,
    employeeView,
    rows,
  };
}
