import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OrgDatePicker } from "@/components/org/org-date-picker";
import { OrgTree } from "@/components/org/org-tree";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { orgTreeAsOf } from "@/modules/org-history/queries";

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

async function OrgData({ params, searchParams }: PageProps<"/[locale]/org">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("Org");
  const { date: raw } = await searchParams;
  const date = isIsoDate(raw) ? raw : new Date().toISOString().slice(0, 10);
  const nodes = await orgTreeAsOf(db, date);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
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
