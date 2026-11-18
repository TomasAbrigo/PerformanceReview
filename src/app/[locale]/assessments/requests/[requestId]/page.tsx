import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GoalsOfPeriod } from "@/components/assessments/goals-of-period";
import {
  type FormQuestion,
  ReviewForm,
} from "@/components/assessments/review-form";
import { Panel } from "@/components/insights/parts";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db/client";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { getAssessment, pickLocalized } from "@/modules/assessments";
import { getReview, ReviewError } from "@/modules/review-core";
import { cycleName } from "@/modules/review-core/cycle-name";
import { canAnswer } from "@/modules/review-capture";
import { saveDraftAction, submitAction } from "./actions";

type Props = PageProps<"/[locale]/assessments/requests/[requestId]">;

async function RequestPage({ params }: Props) {
  const { locale, requestId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  if (actor.role === "direction") {
    return redirect({ href: "/insights/completion", locale });
  }
  const t = await getTranslations("Capture");
  const ta = await getTranslations("Assessments");
  const back = (
    <Link href="/assessments" className="button-outline">
      {t("back")}
    </Link>
  );
  // Reading goes through canRead (the reviewer and People read it).
  const review = await getReview(db, actor, requestId);
  if (!review) {
    return (
      <PageHeader
        kicker={ta("kicker")}
        title={ta("title")}
        description={t("notFound")}
        actions={back}
      />
    );
  }
  const { request, cycle, participant } = review;
  // The goals of the period, as the assessment page shows them.
  let detail = null;
  try {
    detail = await getAssessment(db, actor, cycle.id, participant.id);
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
  }
  const mayWrite = canAnswer(actor, request);
  const writable =
    mayWrite && request.status === "draft" && cycle.status !== "closed";
  const note = writable
    ? null
    : request.status === "submitted"
      ? t("state.submitted")
      : cycle.status === "closed"
        ? t("state.closed")
        : !mayWrite
          ? t("state.notYours")
          : t("state.notDraft");

  const questions: FormQuestion[] = review.questions.map((q) => ({
    id: q.id,
    section: pickLocalized(q.sectionTitle, locale),
    prompt: pickLocalized(q.prompt, locale),
    kind: q.kind,
    required: q.required,
    options:
      q.kind === "rating"
        ? (q.scale?.options ?? []).map((o) => ({
            value: String(o.value),
            label: pickLocalized(o.label, locale),
          }))
        : q.kind === "single_choice"
          ? (q.choices ?? []).map((c) => ({
              value: c.value,
              label: pickLocalized(c.label, locale),
            }))
          : [],
  }));
  const initial = Object.fromEntries(
    Object.entries(review.answers)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, String(v)]),
  );
  const side =
    request.relationship === "self" || request.relationship === "manager"
      ? ta(`detail.sides.${request.relationship}`)
      : ta("title");
  const name = detail?.participant.person.name ?? "";
  const cycleLabel = detail ? cycleName(detail.cycle, locale) : cycle.name;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={ta("kicker")}
        title={name ? `${side} · ${name}` : side}
        description={cycleLabel}
        actions={back}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel id="review-form" title={side} hint={note ?? undefined}>
          <ReviewForm
            questions={questions}
            initial={initial}
            readOnly={!writable}
            save={saveDraftAction.bind(null, request.id)}
            submit={submitAction.bind(null, request.id)}
          />
        </Panel>
        {detail ? (
          <GoalsOfPeriod
            goals={detail.goals}
            name={name}
            asOf={detail.goalsAsOf}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function ReviewRequestPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <RequestPage {...props} />
      </Suspense>
    </main>
  );
}
