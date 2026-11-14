import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NominationsApprovals } from "@/components/review/nominations-approvals";
import { NominationsPicker } from "@/components/review/nominations-picker";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { listPendingApprovals, nominationPicker } from "@/modules/review-core";
import {
  decideNominationsAction,
  nominateAction,
  removeNominationAction,
} from "./actions";

async function Peers({ params }: PageProps<"/[locale]/cycles/[id]/peers">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const picker = await nominationPicker(db, actor, id);
  const approvals = await listPendingApprovals(db, actor, id);
  const t = await getTranslations("Peers");
  return (
    <div className="flex flex-col gap-8">
      {picker ? (
        <NominationsPicker
          data={picker}
          actions={{ nominate: nominateAction, remove: removeNominationAction }}
        />
      ) : (
        <p>{t("notParticipant")}</p>
      )}
      {approvals.length || actor.role === "hr" ? (
        <NominationsApprovals
          items={approvals}
          decide={decideNominationsAction}
        />
      ) : null}
      <Link href="/me" className="underline">
        {t("back")}
      </Link>
    </div>
  );
}

export default function PeersPage(
  props: PageProps<"/[locale]/cycles/[id]/peers">,
) {
  return (
    <main className="mx-auto w-full max-w-3xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Peers {...props} />
      </Suspense>
    </main>
  );
}
