import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { toReviewData } from "@/components/review/review-data";
import { SelfReviewForm } from "@/components/review/self-review-form";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { findMySelfRequestId, getReview } from "@/modules/review-core";
import { saveDraftAction, submitAction } from "./actions";

async function SelfReview({ params }: PageProps<"/[locale]/cycles/[id]/self">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const requestId = await findMySelfRequestId(db, actor, id);
  const review = requestId ? await getReview(db, actor, requestId) : null;
  if (!review) {
    const t = await getTranslations("Review");
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("selfTitle")}</h1>
        <p>{t("notFound")}</p>
        <Link href="/me" className="underline">
          {t("back")}
        </Link>
      </div>
    );
  }
  return (
    <SelfReviewForm
      key={`${review.request.id}-${review.request.status}`}
      review={toReviewData(review)}
      actions={{ save: saveDraftAction, submit: submitAction }}
    />
  );
}

export default function SelfReviewPage(
  props: PageProps<"/[locale]/cycles/[id]/self">,
) {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <SelfReview {...props} />
      </Suspense>
    </main>
  );
}
