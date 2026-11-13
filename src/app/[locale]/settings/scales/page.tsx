import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ScalesView } from "@/components/templates/scales-view";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { listScales } from "@/modules/templates";
import { createScaleAction, deleteScaleAction } from "../actions";

export default async function ScalesPage({
  params,
}: PageProps<"/[locale]/settings/scales">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Scales");
  const tc = await getTranslations("Common");

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <Suspense fallback={<p>{tc("loading")}</p>}>
        <Scales />
      </Suspense>
    </>
  );
}

async function Scales() {
  await connection();
  const scales = await listScales(db);
  return (
    <ScalesView
      scales={scales.map((s) => ({
        id: s.id,
        name: s.name,
        isSystem: s.isSystem,
        options: s.options.map((o) => ({
          value: o.value,
          normalized: o.normalized,
          label: o.label,
        })),
      }))}
      actions={{ create: createScaleAction, remove: deleteScaleAction }}
    />
  );
}
