import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ManagerPicker } from "@/components/goals/manager-picker";
import { TeamGoals } from "@/components/goals/team-goals";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getTeamGoals, listManagers } from "@/modules/goals";

// `?manager=<personId>` stands in for the signed-in manager until the
// "act as" selector exists; without it the page lets you pick one.
async function TeamGoalsData({
  params,
  searchParams,
}: PageProps<"/[locale]/team/goals">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const { manager } = await searchParams;
  const managerId = typeof manager === "string" ? manager : "";

  if (!managerId) return <ManagerPicker managers={await listManagers(db)} />;
  const team = await getTeamGoals(db, managerId);
  if (!team) notFound();
  return <TeamGoals team={team} />;
}

export default function TeamGoalsPage(
  props: PageProps<"/[locale]/team/goals">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense>
        <TeamGoalsData {...props} />
      </Suspense>
    </main>
  );
}
