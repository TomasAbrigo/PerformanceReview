import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PeerFeedbackView } from "@/components/review/peer-feedback-view";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  findMyParticipantId,
  listPeerFeedback,
  participantRefs,
} from "@/modules/review-core";

/** Peer/upward feedback about a participant (`me`: the actor's own). */
async function Feedback({
  params,
}: PageProps<"/[locale]/cycles/[id]/peers/feedback/[participantId]">) {
  const { locale, id, participantId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const pid =
    participantId === "me"
      ? await findMyParticipantId(db, actor, id)
      : participantId;
  const items = pid ? await listPeerFeedback(db, actor, pid) : [];
  const refs =
    pid && participantId !== "me" ? await participantRefs(db, pid) : null;
  const t = await getTranslations("Peers");
  return (
    <div className="flex flex-col gap-4">
      <PeerFeedbackView
        title={refs ? `${t("feedbackTitle")}: ${refs.revieweeName}` : undefined}
        items={items.map((i) => ({
          requestId: i.requestId,
          relationship: i.relationship,
          reviewerName: i.reviewerName,
          reviewerVisible: i.reviewerVisible,
          questions: i.questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            kind: q.kind,
            scale: q.scale,
            choices: q.choices,
          })),
          answers: i.answers,
        }))}
      />
      <Link
        href={participantId === "me" ? "/me" : "/team"}
        className="underline"
      >
        {t("back")}
      </Link>
    </div>
  );
}

export default function PeerFeedbackPage(
  props: PageProps<"/[locale]/cycles/[id]/peers/feedback/[participantId]">,
) {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Feedback {...props} />
      </Suspense>
    </main>
  );
}
