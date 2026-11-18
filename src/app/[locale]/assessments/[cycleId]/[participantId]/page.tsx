import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AssessmentView } from "@/components/assessments/assessment-view";
import { parseAssessmentView } from "@/components/assessments/url-state";
import { PageHeader } from "@/components/page-header";
import { queryString } from "@/components/query-string";
import { db } from "@/db/client";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { individualScope } from "@/modules/actor/individual-scope";
import { getActor } from "@/modules/actor/server";
import { getAssessment } from "@/modules/assessments";
import { cycleName } from "@/modules/review-core/cycle-name";
import { ReviewError } from "@/modules/review-core";

async function AssessmentPage({
  params,
  searchParams,
}: PageProps<"/[locale]/assessments/[cycleId]/[participantId]">) {
  const { locale, cycleId, participantId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  if (actor.role === "direction") {
    return redirect({ href: "/insights/completion", locale });
  }
  const t = await getTranslations("Assessments");
  const back = (
    <Link href="/assessments" className="button-outline">
      {t("title")}
    </Link>
  );
  if (individualScope(actor).kind === "none") {
    return (
      <PageHeader
        kicker={t("kicker")}
        title={t("title")}
        description={t("noPerson")}
      />
    );
  }
  const view = parseAssessmentView(await searchParams);
  let detail;
  try {
    detail = await getAssessment(db, actor, cycleId, participantId, {
      employeeView: view === "employee",
    });
  } catch (error) {
    if (error instanceof ReviewError) {
      if (error.code === "not_found") notFound();
      if (error.code === "forbidden") {
        return (
          <PageHeader
            kicker={t("kicker")}
            title={t("title")}
            description={t("forbidden")}
            actions={back}
          />
        );
      }
    }
    throw error;
  }
  const cycle = cycleName(detail.cycle, locale);
  const here = `/assessments/${cycleId}/${participantId}`;
  const isEmployee = actor.personId === detail.participant.person.id;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t("kicker")}
        title={detail.participant.person.name}
        description={cycle}
        actions={
          <>
            {actor.role === "hr" ? (
              <Link
                href={`/insights/indicators/trend${queryString({ person: detail.participant.person.id })}`}
                className="button-outline"
              >
                {t("detail.analysis", { name: detail.participant.person.name })}
              </Link>
            ) : null}
            <Link
              href={`/assessments${queryString({ cycle: cycleId })}`}
              className="button-outline"
            >
              {t("detail.back", { cycle })}
            </Link>
          </>
        }
      />
      <AssessmentView
        detail={detail}
        cycleName={cycle}
        toggle={
          isEmployee
            ? undefined
            : { full: here, employee: `${here}?view=employee` }
        }
      />
    </div>
  );
}

export default function AssessmentDetailPage(
  props: PageProps<"/[locale]/assessments/[cycleId]/[participantId]">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <AssessmentPage {...props} />
      </Suspense>
    </main>
  );
}
