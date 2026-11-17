import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { GoalStatus } from "@/db/schema";

/** A goal of the period as the participant's snapshot kept it. */
export type PeriodGoalView = {
  id: string;
  title: string;
  status: GoalStatus;
  percentComplete: number;
  /** yyyy-mm-dd. */
  dueDate: string | null;
  /** In progress and due before the period ended. */
  overdue: boolean;
  noLongerApplicable: boolean;
};

const STATUS_VARIANT = {
  in_progress: "default",
  completed: "secondary",
  closed: "outline",
} as const satisfies Record<GoalStatus, string>;

/**
 * The goals of a person in the cycle's period (read only): title, status,
 * progress and due date as of the snapshot, with the overdue ones and the
 * ones deleted since ("ya no aplica") flagged in words, not just in colour.
 */
export function PeriodGoalsBlock({
  goals,
  asOf,
}: {
  goals: PeriodGoalView[];
  /** When the goals were captured; null without goals. */
  asOf: Date | null;
}) {
  const t = useTranslations("ParticipantDetail.goals");
  const format = useFormatter();
  // Due dates come as yyyy-mm-dd: format them as UTC so the day never shifts.
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  const completed = goals.filter(
    (g) => g.status === "completed" && !g.noLongerApplicable,
  ).length;
  const applicable = goals.filter((g) => !g.noLongerApplicable).length;
  return (
    <section
      aria-labelledby="period-goals-title"
      data-testid="period-goals"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2 id="period-goals-title" className="text-lg font-medium">
          {t("title")}
        </h2>
        {goals.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("summary", { completed, total: applicable })}
            {asOf
              ? ` · ${t("asOf", {
                  date: format.dateTime(asOf, {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }),
                })}`
              : ""}
          </p>
        ) : null}
      </div>
      {goals.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {goals.map((g) => (
            <li key={g.id}>
              <article
                aria-label={g.title}
                className={`flex h-full flex-col gap-2 rounded-md border p-3 ${g.noLongerApplicable ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium">{g.title}</h3>
                  <Badge variant={STATUS_VARIANT[g.status]}>
                    {t(`status.${g.status}`)}
                  </Badge>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {g.dueDate
                      ? t("dueDate", { date: day(g.dueDate) })
                      : t("noDueDate")}
                  </span>
                  {g.overdue ? (
                    <Badge variant="destructive">{t("overdue")}</Badge>
                  ) : null}
                  {g.noLongerApplicable ? (
                    <Badge variant="secondary">{t("noLongerApplicable")}</Badge>
                  ) : null}
                </p>
                <div className="flex items-center gap-2">
                  <div
                    role="progressbar"
                    aria-label={t("progress")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={g.percentComplete}
                    className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${g.percentComplete}%` }}
                    />
                  </div>
                  <span className="w-10 text-right tabular-nums">
                    {g.percentComplete}%
                  </span>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
