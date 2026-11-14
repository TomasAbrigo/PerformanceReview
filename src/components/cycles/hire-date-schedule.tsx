"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { hireDateTimeline } from "@/modules/review-core/hire-date-schedule";
import {
  type HireDateSchedule,
  hireMilestoneDays,
  type HireMilestoneDays,
  hireWindowWeeks,
  type HireWindowWeeks,
} from "@/modules/review-core/status";

export type SampleHire = { displayName: string; hireDate: string };

/**
 * Milestone and window of a hire-date cycle, with a preview of the dates a
 * recent hire would get (so People can sanity-check the cadence).
 */
export function HireDateScheduleFields({
  value,
  onChange,
  sample,
}: {
  value: HireDateSchedule;
  onChange: (value: HireDateSchedule) => void;
  /** A recent hire to preview the dates with, if there is one. */
  sample: SampleHire | null;
}) {
  const t = useTranslations("Cycles.extras.schedule");
  const id = useId();
  const timeline = sample ? hireDateTimeline(sample.hireDate, value) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("hireDateHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-milestone`}>{t("milestone")}</Label>
          <select
            id={`${id}-milestone`}
            className="h-9 rounded-md border bg-transparent px-2"
            value={value.milestoneDays}
            onChange={(e) =>
              onChange({
                ...value,
                milestoneDays: Number(e.target.value) as HireMilestoneDays,
              })
            }
          >
            {hireMilestoneDays.map((days) => (
              <option key={days} value={days}>
                {t(`milestones.${days}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-window`}>{t("window")}</Label>
          <select
            id={`${id}-window`}
            className="h-9 rounded-md border bg-transparent px-2"
            value={value.windowWeeks}
            onChange={(e) =>
              onChange({
                ...value,
                windowWeeks: Number(e.target.value) as HireWindowWeeks,
              })
            }
          >
            {hireWindowWeeks.map((weeks) => (
              <option key={weeks} value={weeks}>
                {t("weeks", { count: weeks })}
              </option>
            ))}
          </select>
        </div>
      </div>
      <section
        aria-label={t("previewTitle")}
        className="flex flex-col gap-1 rounded-md border p-3 text-sm"
      >
        <h3 className="font-medium">{t("previewTitle")}</h3>
        {sample && timeline ? (
          <ul>
            <li>
              {t("sample", {
                name: sample.displayName,
                hireDate: sample.hireDate,
              })}
            </li>
            <li>{t("milestoneDate", { date: timeline.milestoneDate })}</li>
            <li>{t("dueDate", { date: timeline.dueDate })}</li>
          </ul>
        ) : (
          <p className="text-muted-foreground">{t("noSample")}</p>
        )}
      </section>
    </div>
  );
}
