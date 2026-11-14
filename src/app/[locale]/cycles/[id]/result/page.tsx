import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AcknowledgeBox } from "@/components/review/acknowledge-box";
import { FollowUpNotes } from "@/components/review/follow-up-notes";
import { ManagerResultView } from "@/components/review/manager-result";
import { toReviewData } from "@/components/review/review-data";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  bothSubmitted,
  findMySharedReviewId,
  getAcknowledgement,
  getReview,
  listFollowUpNotes,
  loadParticipantScope,
  mayListFollowUp,
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
  // The participant is loaded once; the notes, the acknowledgement and the
  // comparison link all decide on it.
  const scope = review
    ? await loadParticipantScope(db, review.request.participantId)
    : null;
  const [ack, notes] = scope
    ? await Promise.all([
        getAcknowledgement(db, actor, scope),
        mayListFollowUp(actor, scope)
          ? listFollowUpNotes(db, actor, scope)
          : [],
      ])
    : [null, []];
  return (
    <div className="flex flex-col gap-8">
      <ManagerResultView
        review={review ? { ...toReviewData(review), dueDate: null } : null}
      />
      {scope && ack ? (
        <>
          {/* The comparison needs both reviews submitted (the manager's is). */}
          {bothSubmitted(scope) ? (
            <Link
              href={`/cycles/${id}/compare/${scope.participant.id}`}
              className="underline"
            >
              {t("openMine")}
            </Link>
          ) : null}
          <FollowUpNotes
            participantId={scope.participant.id}
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
