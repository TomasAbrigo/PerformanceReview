import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { UploadForm } from "@/components/imports/upload-form";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listProfiles } from "@/modules/lake/upload-store";
import { importUploadAction, inspectUploadAction } from "./actions";

/** Built-in profiles plus the custom ones saved so far (read per request). */
async function UploadData() {
  await connection();
  const profiles = await listProfiles();
  return (
    <UploadForm
      profiles={profiles}
      actions={{ inspect: inspectUploadAction, importFile: importUploadAction }}
    />
  );
}

export default async function UploadPage({
  params,
}: PageProps<"/[locale]/imports/upload">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Upload");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <Link href="/" className="text-sm underline">
        {t("back")}
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>
      <Suspense>
        <UploadData />
      </Suspense>
    </main>
  );
}
