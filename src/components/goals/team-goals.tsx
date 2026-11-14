import { useTranslations } from "next-intl";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { Link } from "@/i18n/navigation";
import type { TeamGoalsData } from "@/modules/goals";
import { GoalCard } from "./goal-card";

/** Goals of a manager's direct reports, one group per report. */
export function TeamGoals({ team }: { team: TeamGoalsData }) {
  const t = useTranslations("Goals");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("team.title")}</h1>
          <p className="text-muted-foreground">
            {t("team.description", { manager: team.manager.displayName })}
          </p>
        </div>
        <ExportCsvLink file="goals" params={{ manager_id: team.manager.id }} />
      </div>

      {team.reports.length === 0 && (
        <p>{t("team.noReports", { manager: team.manager.displayName })}</p>
      )}

      {team.reports.map(({ person, goals }) => (
        <section
          key={person.id}
          aria-labelledby={`report-${person.id}`}
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline gap-3">
            <h2 id={`report-${person.id}`} className="text-lg font-medium">
              <Link href={`/people/${person.id}`} className="hover:underline">
                {person.displayName}
              </Link>
            </h2>
            {goals.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {t("team.goalCount", { count: goals.length })}
              </span>
            )}
          </div>
          {goals.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("team.noGoals")}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {goals.map((g) => (
                <GoalCard key={g.id} goal={g} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
