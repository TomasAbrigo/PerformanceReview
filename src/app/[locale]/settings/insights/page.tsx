import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { HrOnly } from "@/components/access/hr-only";
import { InsightsSettingsForm } from "@/components/settings/insights-settings-form";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getSettings } from "@/modules/settings";
import { updateInsightsSettingsAction } from "./actions";

async function InsightsSettings({
  params,
}: PageProps<"/[locale]/settings/insights">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("InsightsSettings");
  const kicker = await groupKicker("settings");
  const values = await getSettings(db);
  return (
    <>
      <PageHeader
        kicker={kicker}
        title={t("title")}
        description={t("description")}
      />
      <InsightsSettingsForm
        values={values}
        save={updateInsightsSettingsAction}
      />
    </>
  );
}

export default function InsightsSettingsPage(
  props: PageProps<"/[locale]/settings/insights">,
) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <HrOnly>
          <InsightsSettings {...props} />
        </HrOnly>
      </Suspense>
    </main>
  );
}
