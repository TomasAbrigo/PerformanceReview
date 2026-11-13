"use client";

import { useFormatter, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { SelfAssessmentTask } from "@/modules/review-core/requests";

export type MyTasksData = { selfAssessments: SelfAssessmentTask[] };

/** Formats an ISO date (YYYY-MM-DD) without shifting it by the time zone. */
export function useIsoDate() {
  const format = useFormatter();
  return (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
}

export function MyTasksView({
  tasks,
  hasPerson,
}: {
  tasks: MyTasksData;
  hasPerson: boolean;
}) {
  const t = useTranslations("Me");
  const isoDate = useIsoDate();
  const empty = tasks.selfAssessments.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {!hasPerson ? (
        <p className="text-muted-foreground">{t("noPerson")}</p>
      ) : empty ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <section aria-labelledby="self-tasks" className="flex flex-col gap-2">
          <h2 id="self-tasks" className="text-lg font-medium">
            {t("selfAssessments")}
          </h2>
          <ul className="flex flex-col gap-2">
            {tasks.selfAssessments.map((task) => (
              <li
                key={task.requestId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-4"
              >
                <div className="flex flex-col">
                  <span className="font-medium">
                    {t("selfTask", { cycle: task.cycleName })}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {task.dueDate
                      ? t("due", { date: isoDate(task.dueDate) })
                      : t("noDue")}
                  </span>
                </div>
                <Link
                  href={`/cycles/${task.cycleId}/self`}
                  className={buttonVariants({ size: "sm" })}
                >
                  {t("open")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
