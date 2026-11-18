// Drizzle- and server-free: the capture rules, shared by the service and the form.
import type { FieldIssue } from "@/lib/domain-error";
import type { ActorContext } from "@/modules/actor/types";
import type { QuestionRevision } from "@/db/schema/review-cycles";

/** Value of an answer as the form sends it (rating: the scale value). */
export type CaptureValue = string | number | null;
export type CaptureAnswer = { questionRevisionId: string; value: CaptureValue };

/** What validation needs of a frozen question. */
export type CaptureQuestion = Pick<
  QuestionRevision,
  "id" | "kind" | "required" | "scale" | "choices"
>;

/** The columns of an answer row. */
export type AnswerColumns = {
  questionRevisionId: string;
  optionValue: number | null;
  optionLabel: string | null;
  normalized: number | null;
  textValue: string | null;
};

/** Why an answer was rejected (the `message` of its issue). */
export type CaptureIssue =
  "required" | "out_of_scale" | "invalid_choice" | "unknown_question";

/**
 * The single rule of who may write a request's answers (and submit or share
 * it): its reviewer, or People. Direction never writes; an actor without a
 * person is only ever People.
 */
export function canAnswer(
  actor: ActorContext,
  request: { reviewerPersonId: string | null },
): boolean {
  if (actor.role === "hr") return true;
  if (actor.role === "direction") return false;
  return actor.personId !== null && actor.personId === request.reviewerPersonId;
}

const none = {
  optionValue: null,
  optionLabel: null,
  normalized: null,
  textValue: null,
};

const isBlank = (value: CaptureValue) =>
  value === null || (typeof value === "string" && value.trim() === "");

/**
 * Checks answers against the questions: a rating must be a value of the
 * question's scale, a single choice one of its choices, and the question must
 * belong to the form. Blank values clear the answer (a draft may leave
 * anything empty; required ones are checked on submit, see missingRequired).
 */
export function checkAnswers(
  questions: CaptureQuestion[],
  answers: CaptureAnswer[],
): { rows: AnswerColumns[]; clear: string[]; issues: FieldIssue[] } {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const rows: AnswerColumns[] = [];
  const clear: string[] = [];
  const issues: FieldIssue[] = [];
  const fail = (path: string, message: CaptureIssue) =>
    issues.push({ path, message });
  for (const { questionRevisionId: id, value } of answers) {
    const q = byId.get(id);
    if (!q) {
      fail(id, "unknown_question");
      continue;
    }
    if (isBlank(value)) {
      clear.push(id);
      continue;
    }
    if (q.kind === "rating") {
      const n = typeof value === "number" ? value : Number(value);
      const option = q.scale?.options.find((o) => o.value === n);
      if (!option) {
        fail(id, "out_of_scale");
        continue;
      }
      rows.push({
        ...none,
        questionRevisionId: id,
        optionValue: option.value,
        optionLabel: option.label.es,
        normalized: option.normalized,
      });
    } else if (q.kind === "single_choice") {
      const choice = q.choices?.find((c) => c.value === String(value));
      if (!choice) {
        fail(id, "invalid_choice");
        continue;
      }
      rows.push({ ...none, questionRevisionId: id, optionLabel: choice.value });
    } else {
      rows.push({
        ...none,
        questionRevisionId: id,
        textValue: String(value).trim(),
      });
    }
  }
  return { rows, clear, issues };
}

/** The required questions without an answer, in form order. */
export const missingRequired = (
  questions: Pick<CaptureQuestion, "id" | "required">[],
  answered: Set<string>,
): FieldIssue[] =>
  questions
    .filter((q) => q.required && !answered.has(q.id))
    .map((q) => ({ path: q.id, message: "required" satisfies CaptureIssue }));
