import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AcknowledgeBox } from "@/components/review/acknowledge-box";
import { CompareView } from "@/components/review/compare-view";
import { FollowUpNotes } from "@/components/review/follow-up-notes";
import { db } from "@/db/client";
import { DomainError } from "@/lib/domain-error";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  canAddFollowUp,
  compareReviews,
  getAcknowledgement,
  listFollowUpNotes,
  ReviewError,
  type Comparison,
} from "@/modules/review-core";
import { acknowledgeAction, addFollowUpAction } from "./actions";

/** The value, or `fallback` when the domain refuses the actor. */
async function orElse<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof DomainError) return fallback;
    throw error;
  }
}

async function Compare({
  params,
}: PageProps<"/[locale]/cycles/[id]/compare/[participantId]">) {
  const { locale, id, participantId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const t = await getTranslations("Compare");
  const actor = await getActor();

  let comparison: Comparison | null = null;
  let code = "not_found";
  try {
    comparison = await compareReviews(db, actor, participantId);
    if (comparison.cycleId !== id) comparison = null;
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    code = error.code;
  }
  if (!comparison) {
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
  const [notes, ack, canAdd] = await Promise.all([
    orElse(listFollowUpNotes(db, actor, participantId), []),
    orElse(getAcknowledgement(db, actor, participantId), null),
    canAddFollowUp(db, actor, participantId),
  ]);

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
        <FollowUpNotes
          participantId={participantId}
          notes={notes}
          canAdd={canAdd}
          add={addFollowUpAction}
        />
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
