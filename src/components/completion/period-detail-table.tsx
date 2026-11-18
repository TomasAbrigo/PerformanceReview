import { CardCollection } from "@/components/card-collection";
import { CalendarRange } from "lucide-react";
import { IconTile } from "@/components/experience";
import { ProgressBar } from "@/components/progress-bar";
import { useFormatter, useTranslations } from "next-intl";
import type {
  MeanOf,
  PeriodDetail,
} from "@/modules/analytics/period-detail/types";

/**
 * "Detalle por período": one row per cycle, oldest first, with the head count,
 * the self and manager completion, the mean of the valued (self, 1-4),
 * retention and engagement (manager, 1-5) answers with the people behind each
 * mean, and the share of goals completed. A figure direction cannot see
 * (under the minimum group size) is "Oculto"; one with nothing behind it "—".
 */
export function PeriodDetailTable({ data }: { data: PeriodDetail }) {
  const t = useTranslations("Completion.period");
  const format = useFormatter();
  const hidden = data.minGroupSize !== null;
  const empty = hidden ? t("hidden") : "—";
  const mean = (m: MeanOf | null) =>
    m === null ? (
      empty
    ) : (
      <>
        {format.number(m.mean, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
        <span className="text-xs text-muted-foreground">
          {" "}
          {t("people", { n: m.n })}
        </span>
      </>
    );
  const date = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  if (!data.rows.length) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <CardCollection
      gridClassName="record-grid"
      data-testid="period-detail"
      role="group"
      aria-label={t("label")}
    >
      {data.rows.map((r) => (
        <article
          key={r.cycleId}
          data-cycle={r.cycleId}
          className="record-card"
          aria-label={r.cycleName}
        >
          <header className="flex items-start gap-3">
            <IconTile>
              <CalendarRange className="size-5" />
            </IconTile>
            <div>
              <h3 className="text-xl">{r.cycleName}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {date(r.periodStart)} – {date(r.periodEnd)}
              </p>
            </div>
          </header>
          <p className="text-sm">{t("people", { n: r.participants })}</p>
          <div className="grid gap-4 rounded-lg bg-brand-fog p-4">
            {(
              [
                ["self", r.selfRate],
                ["manager", r.managerRate],
                [
                  "goals",
                  r.goalsCompletedPct === null
                    ? null
                    : r.goalsCompletedPct / 100,
                ],
              ] as const
            ).map(([key, rate]) => (
              <div key={key}>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t(`columns.${key}`)}
                </p>
                {rate === null ? (
                  <p>{empty}</p>
                ) : (
                  <ProgressBar
                    percent={rate * 100}
                    label={t(`columns.${key}`)}
                  />
                )}
              </div>
            ))}
          </div>
          <dl className="record-facts">
            {(
              [
                ["valued", r.valued],
                ["retention", r.retention],
                ["engagement", r.engagement],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`columns.${key}`)}</dt>
                <dd>{mean(value)}</dd>
              </div>
            ))}
          </dl>
          {r.goals ? (
            <p className="text-xs text-muted-foreground">
              {t("goalsOf", { n: r.goals })}
            </p>
          ) : null}
        </article>
      ))}
    </CardCollection>
  );
}
