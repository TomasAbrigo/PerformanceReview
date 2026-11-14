import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { IndicatorDetail } from "@/components/data-quality/indicator-detail";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getIndicator } from "@/modules/analytics/data-quality";

async function IndicatorData({
  params,
}: PageProps<"/[locale]/data-quality/[key]">) {
  const { locale, key } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const indicator = await getIndicator(db, key);
  if (!indicator) notFound();
  return <IndicatorDetail indicator={indicator} />;
}

export default function IndicatorPage(
  props: PageProps<"/[locale]/data-quality/[key]">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense>
        <IndicatorData {...props} />
      </Suspense>
    </main>
  );
}
