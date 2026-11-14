import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PeerReviewForm } from "@/components/review/peer-review-form";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { getReview, participantRefs } from "@/modules/review-core";
import { saveDraftAction, submitAction } from "../../self/actions";
import { declineRequestAction } from "../actions";

async function PeerReview({
  params,
}: PageProps<"/[locale]/cycles/[id]/peers/[requestId]">) {
  const { locale, id, requestId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const review = await getReview(db, actor, requestId);
  const rel = review?.request.relationship;
  const isAuthor =
    !!review && review.request.reviewerPersonId === actor.personId;
  const refs = review
    ? await participantRefs(db, review.request.participantId)
    : null;
  if (
    !review ||
    !refs ||
    !isAuthor ||
    review.cycle.id !== id ||
    (rel !== "peer" && rel !== "upward")
  ) {
    const t = await getTranslations("Peers");
    return (
      <div className="flex flex-col gap-4">
        <p>{t("errors.not_found")}</p>
        <Link href="/me" className="underline">
          {t("back")}
        </Link>
      </div>
    );
  }
  return (
    <PeerReviewForm
      key={`${review.request.id}-${review.request.status}`}
      revieweeName={refs.revieweeName}
      relationship={rel}
      anonymous={review.request.anonymous}
      review={{
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
        })),
        answers: review.answers,
      }}
      actions={{
        save: saveDraftAction,
        submit: submitAction,
        decline: declineRequestAction,
      }}
    />
  );
}

export default function PeerReviewPage(
  props: PageProps<"/[locale]/cycles/[id]/peers/[requestId]">,
) {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <PeerReview {...props} />
      </Suspense>
    </main>
  );
}
