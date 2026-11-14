import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TeamView } from "@/components/review/team-view";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { listTeam } from "@/modules/review-core";
import { remindAction } from "../cycles/[id]/manager/[participantId]/actions";

async function Team({ params }: PageProps<"/[locale]/team">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const rows = await listTeam(db, actor);
  return (
    <TeamView
      hasPerson={actor.personId !== null}
      rows={rows}
      remind={remindAction}
    />
  );
}

export default function TeamPage(props: PageProps<"/[locale]/team">) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Team {...props} />
      </Suspense>
    </main>
  );
}
