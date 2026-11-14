"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import {
  type SelfReviewData,
  SelfReviewForm,
} from "@/components/review/self-review-form";
import type { ActionResult } from "@/components/templates/shared";
import { Input } from "@/components/ui/input";
import type { AnswerInput, AnswerValue } from "@/modules/review-core/answers";

export type OnBehalfView = Omit<SelfReviewData, "canWrite"> & {
  cycleId: string;
  revieweeName: string | null;
  reviewerName: string | null;
  /** HR may complete it now (see getOnBehalfReview). */
  canComplete: boolean;
};

/**
 * HR completes a draft review in its reviewer's name (#17). Reuses the review
 * form, but answers are kept in the page and sent once with the submission, so
 * the whole thing is a single audited action (no autosave on the server).
 */
export function OpsCompleteOnBehalf({
  view,
  complete,
}: {
  view: OnBehalfView;
  complete: (
    requestId: string,
    answers: AnswerInput[],
    note: string | null,
  ) => Promise<ActionResult>;
}) {
  const t = useTranslations("Ops.complete");
  const id = useId();
  const [note, setNote] = useState("");
  const answers = useRef<Record<string, AnswerValue>>({ ...view.answers });
  const names = {
    reviewer: view.reviewerName ?? "",
    reviewee: view.revieweeName ?? "",
  };
  return (
    <SelfReviewForm
      review={{ ...view, canWrite: view.canComplete }}
      labels={{
        title: t("title", names),
        back: t("back"),
        backHref: `/cycles/${view.cycleId}/participants`,
        confirmTitle: t("confirmTitle", names),
        saving: t("saving"),
        saved: t("saved"),
      }}
      actions={{
        save: async (_requestId, input) => {
          for (const a of input)
            answers.current[a.questionRevisionId] = a.value;
          return { ok: true };
        },
        submit: (requestId) =>
          complete(
            requestId,
            Object.entries(answers.current).map(
              ([questionRevisionId, value]) => ({
                questionRevisionId,
                value,
              }),
            ),
            note.trim() || null,
          ),
      }}
    >
      {view.canComplete ? (
        <div className="flex flex-col gap-2 rounded-md border p-4">
          <p className="text-sm">{t("notice", names)}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-note`} className="text-sm font-medium">
              {t("note")}
            </label>
            <Input
              id={`${id}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t("notAvailable")}
        </p>
      )}
    </SelfReviewForm>
  );
}
