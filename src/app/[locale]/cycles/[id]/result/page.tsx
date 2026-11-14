import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AcknowledgeBox } from "@/components/review/acknowledge-box";
import { FollowUpNotes } from "@/components/review/follow-up-notes";
import { ManagerResultView } from "@/components/review/manager-result";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  findMySharedReviewId,
  getAcknowledgement,
  getReview,
  listFollowUpNotes,
} from "@/modules/review-core";
import { acknowledgeAction } from "../compare/[participantId]/actions";

async function Result({ params }: PageProps<"/[locale]/cycles/[id]/result">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const requestId = await findMySharedReviewId(db, actor, id);
  // getReview applies canRead: only shared, only visible questions.
  const review = requestId ? await getReview(db, actor, requestId) : null;
  const t = await getTranslations("Compare");
  const participantId = review?.request.participantId;
  const [ack, notes] = participantId
    ? await Promise.all([
        getAcknowledgement(db, actor, participantId),
        listFollowUpNotes(db, actor, participantId),
      ])
    : [null, []];
  return (
    <div className="flex flex-col gap-8">
      <ManagerResultView
        review={
          review
            ? {
                requestId: review.request.id,
                cycleName: review.cycle.name,
                dueDate: null,
                status: review.request.status,
                submittedAt: review.request.submittedAt,
                canWrite: false,
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
              }
            : null
        }
      />
      {participantId && ack ? (
        <>
          <Link
            href={`/cycles/${id}/compare/${participantId}`}
            className="underline"
          >
            {t("openMine")}
          </Link>
          <FollowUpNotes
            participantId={participantId}
            notes={notes}
            canAdd={false}
          />
          <AcknowledgeBox
            state={ack}
            viewer="employee"
            acknowledge={acknowledgeAction}
          />
        </>
      ) : null}
    </div>
  );
}

export default function ResultPage(
  props: PageProps<"/[locale]/cycles/[id]/result">,
) {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Result {...props} />
      </Suspense>
    </main>
  );
}
