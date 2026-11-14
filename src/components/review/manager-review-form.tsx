"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { type ActionResult, useLocalized } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GoalsBlockData } from "@/modules/review-core/goal-snapshot";
import { GoalsBlock, type GoalsBlockActions } from "./goals-block";
import {
  type SelfReviewActions,
  type SelfReviewData,
  SelfReviewForm,
  type SelfReviewQuestion,
} from "./self-review-form";

export type ManagerReviewData = SelfReviewData & {
  cycleId: string;
  revieweeName: string;
  sharedAt: Date | null;
  /** The actor may share it (snapshot manager or HR). */
  canShare: boolean;
};

export type ManagerReviewActions = SelfReviewActions & {
  share: (requestId: string) => Promise<ActionResult>;
};

/** Read-only answers of a review (the self review next to the form). */
export function ReadOnlyAnswers({ review }: { review: SelfReviewData }) {
  const t = useTranslations("Review");
  const localized = useLocalized();
  const text = (q: SelfReviewQuestion) => {
    const value = review.answers[q.id];
    const options =
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
  };
  return (
    <dl className="flex flex-col gap-3">
      {review.questions.map((q) => (
        <div key={q.id} className="flex flex-col gap-1">
          <dt className="font-medium">{localized(q.prompt)}</dt>
          <dd className="whitespace-pre-wrap">
            {text(q) ?? (
              <span className="text-muted-foreground">{t("noAnswer")}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The manager's review of a direct report: the template's manager questions
 * (overall rating in the cycle's scale), each marked as visible or not to
 * the employee, the participant's goals (read-only, above the questions, with
 * the goals rating among them), sharing, and the self review
 * side by side once the double blind allows it (`self` null otherwise).
 */
export function ManagerReviewForm({
  review,
  self,
  actions,
  goals,
}: {
  review: ManagerReviewData;
  self: SelfReviewData | null;
  actions: ManagerReviewActions;
  /** The participant's goal snapshot (omit to render no goals block). */
  goals?: { data: GoalsBlockData; actions?: GoalsBlockActions };
}) {
  const t = useTranslations("ManagerReview");
  const tErr = useTranslations("Review.errors");
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function share() {
    startTransition(async () => {
      const result = await actions.share(review.requestId);
      if (result.ok) setError(null);
      else
        setError(
          tErr.has(result.code as "unknown")
            ? tErr(result.code as "unknown")
            : tErr("unknown"),
        );
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <SelfReviewForm
        key={`${review.requestId}-${review.status}`}
        review={review}
        actions={actions}
        labels={{
          title: t("title", { name: review.revieweeName }),
          back: t("back"),
          backHref: "/team",
          confirmTitle: t("confirmTitle"),
        }}
        intro={
          goals ? (
            <GoalsBlock data={goals.data} actions={goals.actions} />
          ) : null
        }
        questionExtra={(q) =>
          q.visibleToReviewee === undefined ? null : (
            <Badge
              variant={q.visibleToReviewee ? "secondary" : "outline"}
              className="self-start"
            >
              {q.visibleToReviewee ? t("visible") : t("hidden")}
            </Badge>
          )
        }
      >
        {review.status === "submitted" ? (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm">
              {review.sharedAt
                ? t("sharedOn", {
                    date: format.dateTime(review.sharedAt, {
                      dateStyle: "medium",
                    }),
                  })
                : t("notShared")}
            </p>
            {review.canShare && !review.sharedAt ? (
              <Button onClick={share} disabled={pending}>
                {t("share")}
              </Button>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </SelfReviewForm>
      <aside aria-labelledby="self-panel" className="flex flex-col gap-4">
        <h2 id="self-panel" className="text-lg font-medium">
          {t("selfTitle")}
        </h2>
        {self ? (
          <ReadOnlyAnswers review={self} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("selfHidden")}</p>
        )}
      </aside>
    </div>
  );
}
