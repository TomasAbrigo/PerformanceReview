import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ManagerReviewForm } from "@/components/review/manager-review-form";
import type { SelfReviewData } from "@/components/review/self-review-form";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  findManagerRequestId,
  getReview,
  participantRefs,
  type Review,
} from "@/modules/review-core";
import { saveDraftAction, submitAction } from "../../self/actions";
import { shareAction } from "./actions";

function toData(review: Review): SelfReviewData {
  return {
    requestId: review.request.id,
    cycleName: review.cycle.name,
    dueDate: review.cycle.dueDate,
    status: review.request.status,
    submittedAt: review.request.submittedAt,
    canWrite: review.canWrite,
    questions: review.questions.map((q) => ({
      id: q.id,
      sectionTitle: q.sectionTitle,
      prompt: q.prompt,
      kind: q.kind,
      required: q.required,
      scale: q.scale,
      choices: q.choices,
      visibleToReviewee: q.visibleToReviewee,
    })),
    answers: review.answers,
  };
}

async function ManagerReview({
  params,
}: PageProps<"/[locale]/cycles/[id]/manager/[participantId]">) {
  const { locale, id, participantId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const requestId = await findManagerRequestId(db, actor, participantId);
  const review = requestId ? await getReview(db, actor, requestId) : null;
  const refs = await participantRefs(db, participantId);
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
  const self = refs.selfRequestId
    ? await getReview(db, actor, refs.selfRequestId)
    : null;
  return (
    <ManagerReviewForm
      review={{
        ...toData(review),
        cycleId: id,
        revieweeName: refs.revieweeName,
        sharedAt: review.request.sharedAt,
        compareHref:
          review.request.status === "submitted" &&
          self?.request.status === "submitted"
            ? `/cycles/${id}/compare/${participantId}`
            : undefined,
        canShare:
          actor.role === "hr" ||
          (actor.personId !== null &&
            actor.personId === review.request.reviewerPersonId),
      }}
      self={self && self.request.status === "submitted" ? toData(self) : null}
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
