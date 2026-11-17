"use client";

import { useTranslations } from "next-intl";
import { type Localized, useLocalized } from "@/components/templates/shared";
import type { AnswerValue } from "@/modules/review-core/answers";
import type { RequestStatus } from "@/modules/review-core/request-status";
import type { QuestionKind } from "@/modules/templates/constants";

export type ReviewQuestion = {
  id: string;
  sectionTitle: Localized;
  prompt: Localized;
  kind: QuestionKind;
  required: boolean;
  scale: {
    options: { value: number; label: Localized; normalized: number }[];
  } | null;
  choices: { value: string; label: Localized }[] | null;
  /** Manager reviews: whether the reviewee sees the answer. */
  visibleToReviewee?: boolean;
};

/** A review as the read-only views show it. */
export type ReviewData = {
  requestId: string;
  cycleName: string;
  dueDate: string | null;
  status: RequestStatus;
  submittedAt: Date | null;
  questions: ReviewQuestion[];
  answers: Record<string, AnswerValue>;
};

/** Options of a rating/single-choice question as {value, label}. */
function optionsOf(q: ReviewQuestion) {
  if (q.kind === "rating") return q.scale?.options ?? [];
  if (q.kind === "single_choice") return q.choices ?? [];
  return [];
}

/** Read-only rendering of one answer. */
export function ReadOnlyAnswer({
  question,
  value,
}: {
  question: ReviewQuestion;
  value: AnswerValue | undefined;
}) {
  const t = useTranslations("Review");
  const localized = useLocalized();
  const option = optionsOf(question).find(
    (o) => String(o.value) === String(value),
  );
  const text = option
    ? localized(option.label)
    : value === null || value === undefined || value === ""
      ? null
      : String(value);
  return (
    <p className="whitespace-pre-wrap">
      {text ?? <span className="text-muted-foreground">{t("noAnswer")}</span>}
    </p>
  );
}

/** Every question of a review with its answer. */
export function ReadOnlyAnswers({ review }: { review: ReviewData }) {
  const localized = useLocalized();
  return (
    <dl className="flex flex-col gap-3">
      {review.questions.map((q) => (
        <div key={q.id} className="flex flex-col gap-1">
          <dt className="font-medium">{localized(q.prompt)}</dt>
          <dd>
            <ReadOnlyAnswer question={q} value={review.answers[q.id]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
