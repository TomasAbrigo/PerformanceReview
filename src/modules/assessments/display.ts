// Drizzle- and server-free: how an answer is shown, shared by the queries' tests and the screens.
import type { LocalizedText } from "@/db/schema/rating-scales";
import { LIKERT_ROLE_MAX, isLikertRole } from "@/modules/likert";
import type { QuestionKind, QuestionRole } from "@/modules/templates/constants";

/** What the display needs of a frozen question. */
export type DisplayQuestion = {
  kind: QuestionKind;
  role: QuestionRole | null;
  scale: { options: { value: number; label: LocalizedText }[] } | null;
  choices: { value: string; label: LocalizedText }[] | null;
};

/** What it needs of the stored answer. */
export type DisplayAnswer = {
  optionValue: number | null;
  optionLabel: string | null;
  textValue: string | null;
};

/**
 * An answer as the Bamboo-like form shows it: open ones as text; closed ones
 * as the value on its scale (`4` of `5`), the option's code (a letter) and its
 * label in the reader's language, e.g. 4/5 "Convencería...".
 */
export type AnswerDisplay =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | {
      kind: "closed";
      value: number | null;
      /** The top of the scale, when it is known. */
      max: number | null;
      code: string | null;
      label: string | null;
    };

/** A text in the reader's language (Spanish, the default, when the other is empty). */
export const pickLocalized = (text: LocalizedText, locale: string): string =>
  (locale === "en" ? text.en : text.es) || text.es || text.en;

export function answerDisplay(
  question: DisplayQuestion,
  answer: DisplayAnswer | undefined,
  locale: string,
): AnswerDisplay {
  if (!answer) return { kind: "none" };
  if (question.kind === "text") {
    const text = answer.textValue?.trim();
    return text
      ? { kind: "text", text: answer.textValue as string }
      : { kind: "none" };
  }
  const { optionValue, optionLabel } = answer;
  if (optionValue === null && !optionLabel) return { kind: "none" };

  if (question.kind === "rating") {
    const options = question.scale?.options ?? [];
    const option = options.find((o) => o.value === optionValue);
    return {
      kind: "closed",
      value: optionValue,
      max: options.length ? Math.max(...options.map((o) => o.value)) : null,
      code: null,
      label: option ? pickLocalized(option.label, locale) : optionLabel,
    };
  }

  // Single choice: the label holds the option's code (a letter), or, for
  // Bamboo's raw report, the option's own text.
  const choice = question.choices?.find((c) => c.value === optionLabel);
  const max =
    optionValue === null
      ? null
      : isLikertRole(question.role)
        ? LIKERT_ROLE_MAX[question.role]
        : null;
  return {
    kind: "closed",
    value: optionValue,
    max,
    // A letter (A, B...) is worth showing; a slug of the label is not.
    code: choice && choice.value.length <= 2 ? choice.value : null,
    label: choice ? pickLocalized(choice.label, locale) : optionLabel,
  };
}
