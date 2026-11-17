import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ParticipantAssessmentView } from "@/components/cycles/participant-assessment";
import { toReviewData } from "@/components/review/review-data";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  type ParticipantAssessment,
  participantAssessment,
} from "@/modules/analytics/goals-insights";
import { ReviewError } from "@/modules/review-core";

async function Detail({
  params,
}: PageProps<"/[locale]/cycles/[id]/participants/[participantId]">) {
  const { locale, id, participantId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("ParticipantDetail");
  let data: ParticipantAssessment;
  try {
    data = await participantAssessment(db, actor, id, participantId);
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    if (error.code === "not_found") notFound();
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">{t("forbidden")}</p>
        <Link href={`/cycles/${id}`} className="underline">
          {t("back")}
        </Link>
      </div>
    );
  }
  return (
    <ParticipantAssessmentView
      data={{
        cycle: data.cycle,
        participant: data.participant,
        goals: data.goals,
        goalsAsOf: data.goalsAsOf,
        reviews: data.reviews.map((r) => ({
          relationship: r.relationship,
          reviewerName: r.reviewerName,
          reviewerMismatch: r.reviewerMismatch,
          review: toReviewData(r.review),
        })),
      }}
    />
  );
}

export default function ParticipantPage(
  props: PageProps<"/[locale]/cycles/[id]/participants/[participantId]">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Detail {...props} />
      </Suspense>
    </main>
  );
}
