import { CardCollection } from "@/components/card-collection";
import { CalendarRange } from "lucide-react";
import { IconTile } from "@/components/experience";
import { ProgressBar } from "@/components/progress-bar";
import { useFormatter, useTranslations } from "next-intl";
import type {
  MeanOf,
  PeriodDetail,
} from "@/modules/analytics/period-detail/types";
import { type DrillBase, DrillLink } from "@/components/drill/drill-link";
import type { Drill } from "@/modules/insights/drill-spec";
import {
  type KpiThresholds,
  likertTone,
  percentTone,
} from "@/modules/insights/tone";

/**
 * #117: what makes each period's figures open their records (the page's
 * drill base: the drill switches the page to that cycle) and toned.
 */
export type PeriodContext = {
  base: DrillBase;
  targets: KpiThresholds;
  riskThreshold: number;
};

/**
 * "Detalle por período": one row per cycle, oldest first, with the head count,
 * the self and manager completion, the mean of the valued (self, 1-4),
 * retention and engagement (manager, 1-5) answers with the people behind each
 * mean, and the share of goals completed. A figure direction cannot see
 * (under the minimum group size) is "Oculto"; one with nothing behind it "—".
 */
export function PeriodDetailTable({
  data,
  context,
}: {
  data: PeriodDetail;
  context?: PeriodContext;
}) {
  const t = useTranslations("Completion.period");
  const format = useFormatter();
  const tx = useTranslations("Experience");
  /** A figure of a period as a drill into that cycle (when it has records). */
  const drillOf = (
    cycleId: string,
    drill: Drill,
    label: string,
    children: React.ReactNode,
  ) =>
    context ? (
      <DrillLink
        base={{
          pathname: context.base.pathname,
          query: { ...context.base.query, cycle: cycleId },
        }}
        drill={drill}
        label={label}
        className="underline decoration-dotted underline-offset-4"
      >
        {children}
      </DrillLink>
    ) : (
      children
    );
  const hidden = data.minGroupSize !== null;
  const empty = hidden ? t("hidden") : "—";
  const mean = (m: MeanOf | null, likert: boolean) =>
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
        {likert && context ? (
          <span
            className="tone-pill ml-2"
            data-tone={likertTone(m.mean, context.riskThreshold)}
          >
            {tx(`tone.${likertTone(m.mean, context.riskThreshold)}`)}
          </span>
        ) : null}
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
                    tone={
                      context
                        ? percentTone(rate * 100, context.targets)
                        : undefined
                    }
                    figure={drillOf(
                      r.cycleId,
                      key === "goals"
                        ? { kind: "goals", state: "completed" }
                        : { kind: "completion", side: key, state: "submitted" },
                      t("drill", {
                        cycle: r.cycleName,
                        what: t(`columns.${key}`),
                      }),
                      `${Math.round(rate * 100)}%`,
                    )}
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
                <dd>
                  {key === "valued" || value === null
                    ? mean(value, false)
                    : drillOf(
                        r.cycleId,
                        { kind: "indicator", indicator: key, value: null },
                        t("drill", {
                          cycle: r.cycleName,
                          what: t(`columns.${key}`),
                        }),
                        mean(value, true),
                      )}
                </dd>
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
