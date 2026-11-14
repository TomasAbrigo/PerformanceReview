import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AcknowledgeBox } from "@/components/review/acknowledge-box";
import { CompareView } from "@/components/review/compare-view";
import { FollowUpNotes } from "@/components/review/follow-up-notes";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  compareReviews,
  getAcknowledgement,
  listFollowUpNotes,
  loadParticipantScope,
  mayAddFollowUp,
  mayListFollowUp,
  mayViewAcknowledgement,
  ReviewError,
  type Comparison,
  type ParticipantScope,
} from "@/modules/review-core";
import { acknowledgeAction, addFollowUpAction } from "./actions";

async function Compare({
  params,
}: PageProps<"/[locale]/cycles/[id]/compare/[participantId]">) {
  const { locale, id, participantId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("Compare");
  const actor = await getActor();

  // The participant is loaded once: everything below decides on that scope.
  let scope: ParticipantScope | null = null;
  let comparison: Comparison | null = null;
  let code = "not_found";
  try {
    scope = await loadParticipantScope(db, participantId);
    if (scope.cycle.id !== id) throw new ReviewError("not_found");
    comparison = await compareReviews(db, actor, scope);
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    code = error.code;
  }
  if (!scope || !comparison) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">
          {t.has(`unavailable.${code}` as "unavailable.unknown")
            ? t(`unavailable.${code}` as "unavailable.unknown")
            : t("unavailable.unknown")}
        </p>
        <Link href="/team" className="underline">
          {t("back")}
        </Link>
      </div>
    );
  }

  const employee =
    actor.role !== "hr" && actor.personId === comparison.revieweePersonId;
  // What the actor may not see is left out, not shown as empty.
  const notes = mayListFollowUp(actor, scope)
    ? await listFollowUpNotes(db, actor, scope)
    : null;
  const ack = mayViewAcknowledgement(actor, scope)
    ? await getAcknowledgement(db, actor, scope)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={
          employee
            ? `/cycles/${id}/result`
            : `/cycles/${id}/manager/${participantId}`
        }
        className="text-sm text-muted-foreground hover:underline"
      >
        {t("backToReview")}
      </Link>
      <CompareView comparison={comparison}>
        {notes ? (
          <FollowUpNotes
            participantId={participantId}
            notes={notes}
            canAdd={mayAddFollowUp(actor, scope)}
            add={addFollowUpAction}
          />
        ) : null}
        {ack ? (
          <AcknowledgeBox
            state={ack}
            viewer={employee ? "employee" : "manager"}
            acknowledge={employee ? acknowledgeAction : undefined}
          />
        ) : null}
      </CompareView>
    </div>
  );
}

export default function ComparePage(
  props: PageProps<"/[locale]/cycles/[id]/compare/[participantId]">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Compare {...props} />
      </Suspense>
    </main>
  );
}
