import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
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
  const values = await getSettings(db);
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
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
    <Suspense fallback={<div aria-busy="true" className="h-40" />}>
      <HrOnly>
        <InsightsSettings {...props} />
      </HrOnly>
    </Suspense>
  );
}
