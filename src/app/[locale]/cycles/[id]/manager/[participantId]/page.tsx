import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ManagerReviewForm } from "@/components/review/manager-review-form";
import { toReviewData } from "@/components/review/review-data";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  findManagerRequestId,
  getReview,
  getReviewGoals,
  canShare,
  participantRefs,
  shareableNow,
} from "@/modules/review-core";
import { linkGoalAction, refreshGoalsAction } from "../../goals/actions";
import { saveDraftAction, submitAction } from "../../self/actions";
import { shareAction } from "./actions";

async function ManagerReview({
  params,
}: PageProps<"/[locale]/cycles/[id]/manager/[participantId]">) {
  const { locale, id, participantId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const [requestId, refs] = await Promise.all([
    findManagerRequestId(db, actor, participantId),
    participantRefs(db, participantId),
  ]);
  const [review, self] = await Promise.all([
    requestId ? getReview(db, actor, requestId) : null,
    refs?.selfRequestId ? getReview(db, actor, refs.selfRequestId) : null,
  ]);
  if (!review || !refs || review.cycle.id !== id) {
    const t = await getTranslations("ManagerReview");
    return (
      <div className="flex flex-col gap-4">
        <p>{t("notFound")}</p>
        <Link href="/team" className="underline">
          {t("back")}
        </Link>
      </div>
    );
  }
  const goals = await getReviewGoals(db, actor, review);
  return (
    <ManagerReviewForm
      goals={
        goals
          ? {
              data: goals,
              actions: {
                refresh: refreshGoalsAction,
                link: linkGoalAction.bind(null, id),
              },
            }
          : undefined
      }
      review={{
        ...toReviewData(review),
        cycleId: id,
        revieweeName: refs.revieweeName,
        sharedAt: review.request.sharedAt,
        canShare:
          canShare(actor, {
            request: review.request,
            participant: refs.participant,
          }) && shareableNow(refs.cycle),
      }}
      self={
        self && self.request.status === "submitted" ? toReviewData(self) : null
      }
      actions={{
        save: saveDraftAction,
        submit: submitAction,
        share: shareAction,
      }}
    />
  );
}

export default function ManagerReviewPage(
  props: PageProps<"/[locale]/cycles/[id]/manager/[participantId]">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <ManagerReview {...props} />
      </Suspense>
    </main>
  );
}
