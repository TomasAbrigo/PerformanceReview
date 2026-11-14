import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OpsCompleteOnBehalf } from "@/components/cycles/ops-complete-on-behalf";
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
        requestId: review.request.id,
        cycleId: review.cycle.id,
        cycleName: review.cycle.name,
        revieweeName: view.revieweeName,
        reviewerName: view.reviewerName,
        dueDate: review.cycle.dueDate,
        status: review.request.status,
        submittedAt: review.request.submittedAt,
        canComplete: view.canComplete,
        questions: review.questions.map((q) => ({
          id: q.id,
          sectionTitle: q.sectionTitle,
          prompt: q.prompt,
          kind: q.kind,
          required: q.required,
          scale: q.scale,
          choices: q.choices,
        })),
        answers: review.answers,
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
