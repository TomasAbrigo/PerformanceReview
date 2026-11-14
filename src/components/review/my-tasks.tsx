"use client";

import { useFormatter, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { AcknowledgeTasks, type AckTaskView } from "./acknowledge-box";
import type {
  SelfAssessmentTask,
  SharedReviewTask,
} from "@/modules/review-core/requests";

export type MyTasksData = {
  selfAssessments: SelfAssessmentTask[];
  sharedReviews?: SharedReviewTask[];
  /** #15: shared reviews the employee still has to acknowledge. */
  acknowledgements?: AckTaskView[];
};

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
  personId,
}: {
  tasks: MyTasksData;
  hasPerson: boolean;
  /** The acting person, for the link to their review history. */
  personId?: string | null;
}) {
  const t = useTranslations("Me");
  const tAck = useTranslations("Compare.ack.me");
  const isoDate = useIsoDate();
  const shared = tasks.sharedReviews ?? [];
  const acknowledgements = tasks.acknowledgements ?? [];
  const empty =
    tasks.selfAssessments.length === 0 &&
    shared.length === 0 &&
    acknowledgements.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {!hasPerson ? (
        <p className="text-muted-foreground">{t("noPerson")}</p>
      ) : empty ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          {shared.length ? (
            <section
              aria-labelledby="shared-tasks"
              className="flex flex-col gap-2"
            >
              <h2 id="shared-tasks" className="text-lg font-medium">
                {t("sharedReviews")}
              </h2>
              <ul className="flex flex-col gap-2">
                {shared.map((task) => (
                  <li
                    key={task.requestId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-4"
                  >
                    <span className="font-medium">
                      {t("sharedTask", { cycle: task.cycleName })}
                    </span>
                    <Link
                      href={`/cycles/${task.cycleId}/result`}
                      className={buttonVariants({ size: "sm" })}
                    >
                      {t("view")}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <AcknowledgeTasks tasks={acknowledgements} />
          {tasks.selfAssessments.length ? (
            <section
              aria-labelledby="self-tasks"
              className="flex flex-col gap-2"
            >
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
          ) : null}
        </>
      )}
      {hasPerson && personId ? (
        <Link href={`/people/${personId}/reviews`} className="underline">
          {tAck("history")}
        </Link>
      ) : null}
    </div>
  );
}
