import { useTranslations } from "next-intl";
import { useDates } from "@/components/dates";
import { GoalStateBadge } from "@/components/goals/goal-state-badge";
import { Panel } from "@/components/insights/parts";
import { ProgressBar } from "@/components/progress-bar";
import { Link } from "@/i18n/navigation";
import type { SnapshotGoal } from "@/modules/assessments";

/**
 * The goals the cycle's snapshot took for the participant, next to their
 * assessment (the link between Goals and Assessments): title (a link to the
 * goal when the reader may open it), status, progress and due date as they
 * were when the cycle was set up.
 */
export function GoalsOfPeriod({
  goals,
  name,
  asOf,
}: {
  goals: SnapshotGoal[];
  name: string;
  /** When the snapshot was taken (ISO), if known. */
  asOf: string | null;
}) {
  const t = useTranslations("Assessments.detail.goals");
  const d = useDates();
  return (
    <Panel
      id="assessment-goals"
      title={t("title")}
      hint={
        asOf
          ? t("hint", { name, date: d.moment(asOf) })
          : t("hintNoDate", { name })
      }
    >
      {goals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t("title")}>
            <thead>
              <tr>
                <th className="pr-4 text-left">{t("goal")}</th>
                <th className="pr-4 text-left">{t("state")}</th>
                <th className="pr-4 text-left">{t("progress")}</th>
                <th className="text-left">{t("due")}</th>
              </tr>
            </thead>
            <tbody>
              {goals.map((g) => (
                <tr key={g.id}>
                  <th
                    scope="row"
                    className={`pr-4 text-left ${g.noLongerApplicable ? "text-muted-foreground" : ""}`}
                  >
                    {g.openable && g.goalId ? (
                      <Link href={`/goals/${g.goalId}`} className="underline">
                        {g.title}
                      </Link>
                    ) : (
                      g.title
                    )}
                    {g.noLongerApplicable ? (
                      <span className="block text-xs font-normal">
                        {t("noLongerApplicable")}
                      </span>
                    ) : null}
                  </th>
                  <td className="pr-4">
                    <GoalStateBadge state={g.status} />
                  </td>
                  <td className="pr-4">
                    <ProgressBar
                      percent={g.percentComplete}
                      label={`${g.percentComplete}%`}
                    />
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {g.dueDate ? d.day(g.dueDate) : t("noDate")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
