import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { OrgDatePicker } from "@/components/org/org-date-picker";
import { OrgTree } from "@/components/org/org-tree";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { parseIsoDate, todayLocal } from "@/modules/org-history/dates";
import { orgTreeAsOf } from "@/modules/org-history/queries";

async function OrgData({ params, searchParams }: PageProps<"/[locale]/org">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("Org");
  const { date: raw } = await searchParams;
  const date = parseIsoDate(raw) ?? todayLocal();
  const nodes = await orgTreeAsOf(db, date);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <ExportCsvLink file="org" params={{ date }} />
      </div>
      <OrgDatePicker date={date} />
      <OrgTree nodes={nodes} />
    </div>
  );
}

export default function OrgPage(props: PageProps<"/[locale]/org">) {
  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Suspense>
        <OrgData {...props} />
      </Suspense>
    </main>
  );
}
