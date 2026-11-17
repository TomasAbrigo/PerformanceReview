import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HealthCheckView } from "@/components/insights/health-check-view";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { insightsScope } from "@/modules/insights/authz";
import { healthCheckLanding } from "@/modules/insights/health-check";

async function HealthCheck({
  params,
}: PageProps<"/[locale]/insights/health-check">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Insights");
  if (insightsScope(actor).kind === "none") return <p>{t("forbidden")}</p>;
  const data = await healthCheckLanding(db);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("HealthCheck.title")}</h1>
      <HealthCheckView data={data} />
    </div>
  );
}

export default function HealthCheckPage(
  props: PageProps<"/[locale]/insights/health-check">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <HealthCheck {...props} />
      </Suspense>
    </main>
  );
}
