import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CycleWizard } from "@/components/cycles/cycle-wizard";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { todayLocal } from "@/modules/org-history/dates";
import { participantFilterOptions, recentHires } from "@/modules/review-core";
import { listScales, listTemplates } from "@/modules/templates";
import {
  createCycleAction,
  launchCycleAction,
  previewGroupsAction,
  previewParticipantsAction,
} from "../actions";

async function Wizard({ params }: PageProps<"/[locale]/cycles/new">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const [filterOptions, templates, scales, [sampleHire]] = await Promise.all([
    participantFilterOptions(db),
    listTemplates(db),
    listScales(db),
    recentHires(db, 1),
  ]);
  return (
    <CycleWizard
      defaultSnapshotDate={todayLocal()}
      options={{
        ...filterOptions,
        templates: templates
          .filter((t) => t.enabled && !t.deletedAt)
          .map((t) => ({ id: t.id, name: t.name })),
        scales: scales.map((s) => ({ id: s.id, name: s.name })),
        sampleHire: sampleHire ?? null,
      }}
      actions={{
        preview: previewParticipantsAction,
        previewGroups: previewGroupsAction,
        create: createCycleAction,
        launch: launchCycleAction,
      }}
    />
  );
}

export default function NewCyclePage(props: PageProps<"/[locale]/cycles/new">) {
  return (
    <main className="mx-auto w-full max-w-4xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Wizard {...props} />
      </Suspense>
    </main>
  );
}
