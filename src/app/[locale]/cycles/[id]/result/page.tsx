import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ManagerResultView } from "@/components/review/manager-result";
import { toReviewData } from "@/components/review/review-data";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  findMySharedReviewId,
  getReview,
  myPublishedRating,
} from "@/modules/review-core";

async function Result({ params }: PageProps<"/[locale]/cycles/[id]/result">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const requestId = await findMySharedReviewId(db, actor, id);
  // getReview applies canRead: only shared, only visible questions.
  const review = requestId ? await getReview(db, actor, requestId) : null;
  // The overall manager rating (last rating question) feeds final_rating:
  // the employee sees only the final rating below, never the original.
  const overallId = review?.questions.findLast((q) => q.kind === "rating")?.id;
  // Only the current rating, after share + publish (never original/notes).
  const finalRating = await myPublishedRating(db, actor, id);
  const t = await getTranslations("Calibration");
  return (
    <>
      {finalRating ? (
        <p className="mb-4 text-lg" data-testid="final-rating">
          {t("finalRating")}:{" "}
          <span className="font-semibold">
            {finalRating.value}
            {finalRating.label ? ` · ${finalRating.label[locale]}` : null}
          </span>
        </p>
      ) : null}
      <ManagerResultView
        review={
          review
            ? {
                ...toReviewData(review),
                dueDate: null,
                questions: toReviewData(review).questions.filter(
                  (q) => q.id !== overallId,
                ),
              }
            : null
        }
      />
    </>
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
