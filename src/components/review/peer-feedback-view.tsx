"use client";

import { useTranslations } from "next-intl";
import { type Localized, useLocalized } from "@/components/templates/shared";
import type { AnswerValue } from "@/modules/review-core/answers";
import type { SelfReviewQuestion } from "./self-review-form";

export type PeerFeedbackViewItem = {
  requestId: string;
  relationship: "peer" | "upward";
  /** Null when the anonymity mode hides the reviewer from the viewer. */
  reviewerName: string | null;
  reviewerVisible: boolean;
  questions: Pick<
    SelfReviewQuestion,
    "id" | "prompt" | "kind" | "scale" | "choices"
  >[];
  answers: Record<string, AnswerValue>;
};

/**
 * Submitted peer/upward feedback the viewer may read (the domain already
 * filtered it with canRead). Hidden reviewers are labelled "Par".
 */
export function PeerFeedbackView({
  items,
  title,
}: {
  items: PeerFeedbackViewItem[];
  title?: string;
}) {
  const t = useTranslations("Peers");
  const localized = useLocalized();

  function answerText(
    q: PeerFeedbackViewItem["questions"][number],
    value: AnswerValue | undefined,
  ) {
    const options: { value: string | number; label: Localized }[] =
      q.kind === "rating"
        ? (q.scale?.options ?? [])
        : q.kind === "single_choice"
          ? (q.choices ?? [])
          : [];
    const option = options.find((o) => String(o.value) === String(value));
    if (option) return localized(option.label);
    return value === null || value === undefined || value === ""
      ? null
      : String(value);
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{title ?? t("feedbackTitle")}</h1>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{t("feedbackEmpty")}</p>
      ) : (
        items.map((item) => (
          <article
            key={item.requestId}
            className="flex flex-col gap-3 rounded-md border p-4"
          >
            <h2 className="font-medium">
              {item.reviewerVisible && item.reviewerName
                ? item.reviewerName
                : t(item.relationship === "peer" ? "peerLabel" : "upwardLabel")}
            </h2>
            <dl className="flex flex-col gap-2">
              {item.questions.map((q) => (
                <div key={q.id}>
                  <dt className="text-sm text-muted-foreground">
                    {localized(q.prompt)}
                  </dt>
                  <dd className="whitespace-pre-wrap">
                    {answerText(q, item.answers[q.id]) ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))
      )}
    </section>
  );
}
