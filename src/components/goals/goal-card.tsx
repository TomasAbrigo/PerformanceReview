import { Circle, CircleCheck, MessageSquare } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GoalStatus } from "@/db/schema";
import type { GoalView } from "@/modules/goals";

const STATUS_VARIANT = {
  in_progress: "default",
  completed: "secondary",
  closed: "outline",
} as const satisfies Record<GoalStatus, string>;

export function GoalCard({ goal }: { goal: GoalView }) {
  const t = useTranslations("Goals");
  const format = useFormatter();
  // Dates come as yyyy-mm-dd: format them as UTC so the day never shifts.
  const day = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  const done = goal.milestones.filter((m) => m.completedAt).length;

  return (
    <article>
      <Card
        className={goal.status === "closed" ? "opacity-80" : undefined}
        size="sm"
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle>
              <h3>{goal.title}</h3>
            </CardTitle>
            <Badge variant={STATUS_VARIANT[goal.status]}>
              {t(`status.${goal.status}`)}
            </Badge>
          </div>
          <CardDescription className="flex flex-wrap gap-x-3">
            <span>
              {goal.dueDate
                ? t("dueDate", { date: day(goal.dueDate) })
                : t("noDueDate")}
            </span>
            {goal.completionDate && (
              <span>
                {t("completedOn", { date: day(goal.completionDate) })}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {goal.description && (
            <p className="text-muted-foreground">{goal.description}</p>
          )}

          <div className="flex items-center gap-2">
            <div
              role="progressbar"
              aria-label={t("progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={goal.percentComplete}
              className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${goal.percentComplete}%` }}
              />
            </div>
            <span className="w-10 text-right tabular-nums">
              {goal.percentComplete}%
            </span>
          </div>

          {goal.milestones.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">
                {t("milestones.summary", {
                  done,
                  total: goal.milestones.length,
                })}
              </p>
              <ul
                aria-label={t("milestones.title")}
                className="flex flex-col gap-1"
              >
                {goal.milestones.map((m) => (
                  <li key={m.id} className="flex items-start gap-2">
                    {m.completedAt ? (
                      <CircleCheck
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-primary"
                      />
                    ) : (
                      <Circle
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span className="sr-only">
                      {m.completedAt
                        ? t("milestones.done")
                        : t("milestones.pending")}
                    </span>
                    <span
                      className={
                        m.completedAt
                          ? "text-muted-foreground line-through"
                          : undefined
                      }
                    >
                      {m.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MessageSquare aria-hidden className="size-3.5" />
              {t("comments", { count: goal.commentCount })}
            </span>
            {goal.sharedWith.length > 0 && (
              <span>
                {t("sharedWith", {
                  names: goal.sharedWith.map((s) => s.displayName).join(", "),
                })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </article>
  );
}
