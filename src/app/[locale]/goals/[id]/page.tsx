import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { GoalDetailView } from "@/components/goals/goal-detail-view";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db/client";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { individualScope } from "@/modules/actor/individual-scope";
import { getActor } from "@/modules/actor/server";
import { canOpenParticipant } from "@/modules/assessments";
import { getGoalDetail } from "@/modules/goals/browse";
import { ReviewError } from "@/modules/review-core";

async function GoalPage({ params }: PageProps<"/[locale]/goals/[id]">) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  if (actor.role === "direction") {
    return redirect({ href: "/insights/goals", locale });
  }
  const t = await getTranslations("Goals");
  const back = (
    <Link href="/goals" className="button-outline">
      {t("detail.back")}
    </Link>
  );
  if (individualScope(actor).kind === "none") {
    return (
      <PageHeader
        kicker={t("kicker")}
        title={t("title")}
        description={t("noPerson")}
        actions={back}
      />
    );
  }
  let goal;
  try {
    goal = await getGoalDetail(db, actor, id);
  } catch (error) {
    if (error instanceof ReviewError && error.code === "forbidden") {
      return (
        <PageHeader
          kicker={t("kicker")}
          title={t("title")}
          description={t("forbidden")}
          actions={back}
        />
      );
    }
    throw error;
  }
  if (!goal) notFound();
  const openable = new Set(
    goal.appearances
      .filter((a) => canOpenParticipant(actor, a))
      .map((a) => a.participantId),
  );
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t("kicker")}
        title={goal.title}
        description={goal.person.name}
        actions={back}
      />
      <GoalDetailView goal={goal} openableParticipants={openable} />
    </div>
  );
}

export default function GoalDetailPage(
  props: PageProps<"/[locale]/goals/[id]">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <GoalPage {...props} />
      </Suspense>
    </main>
  );
}
