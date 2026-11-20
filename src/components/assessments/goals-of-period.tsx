import { Target } from "lucide-react";
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
  cycleId,
}: {
  goals: SnapshotGoal[];
  name: string;
  /** When the snapshot was taken (ISO), if known. */
  asOf: string | null;
  /** The cycle of the assessment: a goal opens measured at its cut-off. */
  cycleId?: string;
}) {
  const t = useTranslations("Assessments.detail.goals");
  const d = useDates();
  return (
    <Panel
      id="assessment-goals"
      title={t("title")}
      icon={<Target className="size-5" />}
      hint={
        asOf
          ? t("hint", { name, date: d.moment(asOf) })
          : t("hintNoDate", { name })
      }
    >
      {goals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {goals.map((g) => (
            <article
              key={g.id}
              className="flex min-w-0 flex-col gap-4 rounded-xl bg-brand-fog/70 p-5"
            >
              <GoalStateBadge state={g.status} />
              <h3
                className={`text-lg ${g.noLongerApplicable ? "text-muted-foreground" : ""}`}
              >
                {g.openable && g.goalId ? (
                  <Link
                    href={
                      cycleId
                        ? `/goals/${g.goalId}?cycle=${cycleId}`
                        : `/goals/${g.goalId}`
                    }
                    className="underline decoration-brand-200 underline-offset-4 hover:text-primary"
                  >
                    {g.title}
                  </Link>
                ) : (
                  g.title
                )}
              </h3>
              {g.noLongerApplicable ? (
                <p className="text-xs text-muted-foreground">
                  {t("noLongerApplicable")}
                </p>
              ) : null}
              <div className="mt-auto">
                <ProgressBar
                  percent={g.percentComplete}
                  label={t("progressLabel", { percent: g.percentComplete })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("due")}: {g.dueDate ? d.day(g.dueDate) : t("noDate")}
              </p>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
