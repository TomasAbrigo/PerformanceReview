import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { HrOnly } from "@/components/access/hr-only";
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

export default function UploadPage(
  props: PageProps<"/[locale]/imports/upload">,
) {
  return (
    <Suspense>
      <HrOnly>
        <UploadBody {...props} />
      </HrOnly>
    </Suspense>
  );
}

async function UploadBody({ params }: PageProps<"/[locale]/imports/upload">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Upload");
  const kicker = await groupKicker("data");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-6 lg:p-10">
      <PageHeader
        kicker={kicker}
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/" className="text-sm underline">
            {t("back")}
          </Link>
        }
      />
      <Suspense>
        <UploadData />
      </Suspense>
    </main>
  );
}
