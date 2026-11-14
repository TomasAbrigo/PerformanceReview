"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GoalStatus } from "@/db/schema";
import type { GoalsBlockData } from "@/modules/review-core/goal-snapshot";
import { useIsoDate } from "./my-tasks";

export type GoalsBlockActions = {
  /** "Update progress": refresh the figures of the snapshot goals. */
  refresh: (participantId: string) => Promise<ActionResult>;
  /** People links one more goal of the owner to the participant's cycle. */
  link: (goalId: string) => Promise<ActionResult>;
};

const STATUS_VARIANT = {
  in_progress: "default",
  completed: "secondary",
  closed: "outline",
} as const satisfies Record<GoalStatus, string>;

/**
 * The participant's goals as the cycle's snapshot holds them (read-only):
 * title, status, progress bar and due date, with the "progress as of" legend.
 * Whoever may (manager, People) can refresh the figures, which never adds
 * goals; People can also link one of the owner's other goals to the cycle.
 * Used in the self assessment and in the manager review.
 */
export function GoalsBlock({
  data,
  actions,
}: {
  data: GoalsBlockData;
  actions?: GoalsBlockActions;
}) {
  const t = useTranslations("GoalsInCycle");
  const tStatus = useTranslations("Goals.status");
  const tErr = useTranslations("Review.errors");
  const isoDate = useIsoDate();
  const headingId = useId();
  const linkId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toLink, setToLink] = useState("");

  const errorText = (code: string) =>
    tErr.has(code as "unknown") ? tErr(code as "unknown") : tErr("unknown");

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setError(null);
        onDone?.();
      } else {
        setError(errorText(result.code));
      }
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-medium">
        {t("title")}
      </h2>

      {data.goals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <ul aria-labelledby={headingId} className="flex flex-col gap-3">
            {data.goals.map((g) => (
              <li
                key={g.id}
                className={`flex flex-col gap-2 rounded-md border p-3 ${
                  g.noLongerApplicable ? "opacity-70" : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span
                    className={`font-medium ${
                      g.noLongerApplicable ? "line-through" : ""
                    }`}
                  >
                    {g.title}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {g.noLongerApplicable ? (
                      <Badge variant="destructive">
                        {t("noLongerApplicable")}
                      </Badge>
                    ) : null}
                    <Badge variant={STATUS_VARIANT[g.status]}>
                      {tStatus(g.status)}
                    </Badge>
                  </span>
                </div>
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
                  <span className="w-10 text-right text-sm tabular-nums">
                    {g.percentComplete}%
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {g.dueDate
                    ? t("dueDate", { date: isoDate(g.dueDate) })
                    : t("noDueDate")}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            {data.asOf ? (
              <p className="text-sm text-muted-foreground">
                {t("legend", { date: isoDate(data.asOf) })}
              </p>
            ) : null}
            {data.canRefresh && actions ? (
              <Button
                variant="outline"
                size="sm"
                title={t("refreshHint")}
                disabled={pending}
                onClick={() => run(() => actions.refresh(data.participantId))}
              >
                {pending ? t("refreshing") : t("refresh")}
              </Button>
            ) : null}
          </div>
        </>
      )}

      {data.canLink && actions && data.linkable.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={linkId} className="text-sm">
              {t("linkLabel")}
            </label>
            <select
              id={linkId}
              className="h-8 rounded-md border bg-transparent px-2 text-sm"
              value={toLink}
              onChange={(e) => setToLink(e.target.value)}
            >
              <option value="">{t("linkPlaceholder")}</option>
              {data.linkable.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || toLink === ""}
            onClick={() =>
              run(
                () => actions.link(toLink),
                () => setToLink(""),
              )
            }
          >
            {t("link")}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
