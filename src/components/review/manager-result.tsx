"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { type SelfReviewData, SelfReviewForm } from "./self-review-form";

const noActions = {
  save: async () => ({ ok: true as const }),
  submit: async () => ({ ok: true as const }),
};

/**
 * The employee's read-only view of their manager review once shared; the
 * domain (canRead) already left out the questions not visible to them.
 */
export function ManagerResultView({
  review,
}: {
  review: SelfReviewData | null;
}) {
  const t = useTranslations("ManagerReview");
  if (!review) {
    return (
      <div className="flex flex-col gap-4">
        <p>{t("notSharedYet")}</p>
        <Link href="/me" className="underline">
          {t("backToTasks")}
        </Link>
      </div>
    );
  }
  return (
    <SelfReviewForm
      review={{ ...review, canWrite: false }}
      actions={noActions}
      labels={{
        title: t("resultTitle", { cycle: review.cycleName }),
        back: t("backToTasks"),
      }}
    />
  );
}
