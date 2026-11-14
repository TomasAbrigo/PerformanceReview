import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReviewHistory } from "@/components/review/review-history";
import { toReviewData } from "@/components/review/review-data";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  personName,
  ReviewError,
  reviewHistory,
  type HistoryItem,
} from "@/modules/review-core";

async function Reviews({ params }: PageProps<"/[locale]/people/[id]/reviews">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const name = await personName(db, id);
  if (!name) notFound();
  const t = await getTranslations("History");
  const actor = await getActor();

  let items: HistoryItem[];
  try {
    items = await reviewHistory(db, actor, id);
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">{t("forbidden")}</p>
        <Link href={`/people/${id}`} className="underline">
          {t("back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/people/${id}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("back")}
      </Link>
      <ReviewHistory
        personName={name}
        items={items.map((item) => ({
          ...item,
          self: item.self ? toReviewData(item.self) : null,
          manager: item.manager ? toReviewData(item.manager) : null,
        }))}
      />
    </div>
  );
}

export default function PersonReviewsPage(
  props: PageProps<"/[locale]/people/[id]/reviews">,
) {
  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Reviews {...props} />
      </Suspense>
    </main>
  );
}
