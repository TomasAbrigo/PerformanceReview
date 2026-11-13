import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TemplatesView } from "@/components/templates/templates-view";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { listTemplates } from "@/modules/templates";
import {
  cloneTemplateAction,
  createTemplateAction,
  deleteTemplateAction,
} from "../actions";

export default async function TemplatesPage({
  params,
}: PageProps<"/[locale]/settings/templates">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Templates");
  const tc = await getTranslations("Common");

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <Suspense fallback={<p>{tc("loading")}</p>}>
        <Templates />
      </Suspense>
    </>
  );
}

async function Templates() {
  await connection();
  const templates = await listTemplates(db);
  return (
    <TemplatesView
      templates={templates.map((x) => ({
        id: x.id,
        name: x.name,
        isSystem: x.isSystem,
        enabled: x.enabled,
      }))}
      actions={{
        create: createTemplateAction,
        clone: cloneTemplateAction,
        remove: deleteTemplateAction,
      }}
    />
  );
}
