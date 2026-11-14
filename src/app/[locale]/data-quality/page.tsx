import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DataQualityPanel } from "@/components/data-quality/data-quality-panel";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getDataQuality } from "@/modules/analytics/data-quality";

async function PanelData({ params }: PageProps<"/[locale]/data-quality">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  return <DataQualityPanel indicators={await getDataQuality(db)} />;
}

export default function DataQualityPage(
  props: PageProps<"/[locale]/data-quality">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense>
        <PanelData {...props} />
      </Suspense>
    </main>
  );
}
