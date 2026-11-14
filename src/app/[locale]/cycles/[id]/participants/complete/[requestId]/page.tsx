import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OpsCompleteOnBehalf } from "@/components/cycles/ops-complete-on-behalf";
import { toReviewData } from "@/components/review/review-data";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { getOnBehalfReview } from "@/modules/review-core/ops";
import { completeOnBehalfAction } from "../../actions";

async function Complete({
  params,
}: PageProps<"/[locale]/cycles/[id]/participants/complete/[requestId]">) {
  const { locale, id, requestId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  if (actor.role !== "hr") {
    const t = await getTranslations("Ops.complete");
    return <p role="alert">{t("forbidden")}</p>;
  }
  const view = await getOnBehalfReview(db, actor, requestId);
  // The URL's cycle must be the request's cycle.
  if (!view || view.review.request.cycleId !== id) notFound();
  const { review } = view;
  return (
    <OpsCompleteOnBehalf
      key={`${review.request.id}-${review.request.status}`}
      view={{
        ...toReviewData(review),
        cycleId: review.cycle.id,
        revieweeName: view.revieweeName,
        reviewerName: view.reviewerName,
        canComplete: view.canComplete,
      }}
      complete={completeOnBehalfAction}
    />
  );
}

export default function CompletePage(
  props: PageProps<"/[locale]/cycles/[id]/participants/complete/[requestId]">,
) {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Complete {...props} />
      </Suspense>
    </main>
  );
}
