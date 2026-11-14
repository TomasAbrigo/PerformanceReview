"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import type { AnonymityMode } from "@/modules/review-core/status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { usePeerError } from "./nominations-picker";
import {
  type SelfReviewActions,
  type SelfReviewData,
  SelfReviewForm,
} from "./self-review-form";

export type PeerReviewActions = SelfReviewActions & {
  decline: (requestId: string, reason: string) => Promise<ActionResult>;
};

/**
 * Peer (or upward) feedback: the generic review form plus declining with a
 * reason while it is a draft.
 */
export function PeerReviewForm({
  review,
  revieweeName,
  relationship,
  anonymity,
  actions,
}: {
  review: SelfReviewData;
  revieweeName: string;
  relationship: "peer" | "upward";
  /** The cycle's mode for this relationship: who will see the name. */
  anonymity: AnonymityMode;
  actions: PeerReviewActions;
}) {
  const t = useTranslations("Peers");
  const errorText = usePeerError();
  const id = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <SelfReviewForm
        review={review}
        actions={actions}
        labels={{
          title: t(relationship === "peer" ? "formTitle" : "upwardTitle", {
            name: revieweeName,
          }),
          back: t("back"),
        }}
      >
        <p className="text-sm text-muted-foreground">
          {t(`anonymityNote.${anonymity}`)}
        </p>
      </SelfReviewForm>
      {review.status === "declined" ? (
        <p className="text-muted-foreground">{t("declined")}</p>
      ) : review.canWrite ? (
        <section className="flex flex-col gap-2 rounded-md border p-4">
          <h2 className="font-medium">{t("declineTitle")}</h2>
          <Label htmlFor={`${id}-reason`}>{t("declineReason")}</Label>
          <textarea
            id={`${id}-reason`}
            className="min-h-16 w-full rounded-md border bg-transparent p-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div>
            <Button
              variant="outline"
              disabled={!reason.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await actions.decline(
                    review.requestId,
                    reason,
                  );
                  setError(result.ok ? null : errorText(result.code));
                })
              }
            >
              {t("declineConfirm")}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
