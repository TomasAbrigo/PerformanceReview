import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { OpsParticipantsView } from "@/components/cycles/ops-participants";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { getCycleOps } from "@/modules/review-core/ops";
import {
  addParticipantAction,
  assignAssessorAction,
  removeParticipantAction,
  unlockRequestAction,
} from "./actions";

async function Participants({
  params,
}: PageProps<"/[locale]/cycles/[id]/participants">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  if (actor.role !== "hr") {
    const t = await getTranslations("Ops.participants");
    return <p role="alert">{t("forbidden")}</p>;
  }
  const data = await getCycleOps(db, actor, id);
  if (!data) notFound();
  return (
    <OpsParticipantsView
      data={data}
      actions={{
        add: addParticipantAction,
        remove: removeParticipantAction,
        assign: assignAssessorAction,
        unlock: unlockRequestAction,
      }}
    />
  );
}

export default function ParticipantsPage(
  props: PageProps<"/[locale]/cycles/[id]/participants">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Participants {...props} />
      </Suspense>
    </main>
  );
}
