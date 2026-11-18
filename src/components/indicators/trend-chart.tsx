import { useFormatter, useTranslations } from "next-intl";
import { ChartTooltip, LineTrend } from "@/components/charts";
import { Empty, TableView } from "@/components/insights/parts";
import type { IndicatorTrend } from "@/modules/analytics/indicators/types";
import { type DrillBase, drillHref } from "@/components/drill/drill-link";
import { MetricCard } from "@/components/experience";
import type { Drill } from "@/modules/insights/drill-spec";
import { likertTone } from "@/modules/insights/tone";

/** The search param that says which cycle a trend point's drill reads. */
export const DRILL_CYCLE_PARAM = "dcycle";

/** #117: the people behind a trend's point, by its subject (a person: none). */
export function trendDrill(data: IndicatorTrend): Drill | null {
  const s = data.subject;
  switch (s.kind) {
    case "person":
      return null;
    case "all":
      return { kind: "indicator", indicator: data.indicator, value: null };
    case "manager":
      return {
        kind: "indicatorGroup",
        indicator: data.indicator,
        value: null,
        groupBy: "manager",
        key: s.managerId,
      };
    case "department":
      return {
        kind: "indicatorGroup",
        indicator: data.indicator,
        value: null,
        groupBy: "department",
        key: s.department,
      };
  }
}

/**
 * One indicator (1-5) cycle by cycle: a 2px line through the means (the value
 * itself for a person), 8px markers, a recessive grid at each value, a tooltip
 * per point and a table with n and the count of each value. Cycles that
 * direction cannot see (under the minimum) leave a gap.
 */
export function TrendChart({
  data,
  subject,
  drillBase,
  riskThreshold,
}: {
  data: IndicatorTrend;
  /** #117: points open their people (the page's base). */
  drillBase?: DrillBase;
  /** #117: the tone of the latest mean. */
  riskThreshold?: number;
  /** Who the line is about, already as text (for the label). */
  subject: string;
}) {
  const t = useTranslations("Indicators");
  const format = useFormatter();
  const num = (v: number) =>
    format.number(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (!data.points.length) return <Empty />;
  const indicator = t(`indicator.${data.indicator}`);
  const pointText = (p: IndicatorTrend["points"][number]) =>
    t("trend.point", {
      cycle: p.cycleName,
      value: p.mean === null ? t("trend.hidden") : num(p.mean),
    });
  const drill = drillBase ? trendDrill(data) : null;
  const seen = data.points.filter((p) => p.mean !== null);
  const last = seen.at(-1);
  const before = seen.at(-2);
  return (
    <div className="flex flex-col gap-3" data-testid="trend-chart">
      {last ? (
        <MetricCard
          testId="trend-kpi"
          label={t("trend.latest", { cycle: last.cycleName })}
          value={num(last.mean!)}
          status={
            riskThreshold === undefined
              ? undefined
              : likertTone(last.mean!, riskThreshold)
          }
          scale={{
            value: last.mean!,
            min: 1,
            max: 5,
            label: t("kpi.scale", { indicator, value: num(last.mean!) }),
          }}
          delta={
            before
              ? {
                  value: last.mean! - before.mean!,
                  text: t("kpi.vs", {
                    delta: format.number(last.mean! - before.mean!, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                      signDisplay: "exceptZero",
                    }),
                    cycle: before.cycleName,
                  }),
                }
              : undefined
          }
          note={last.n === null ? undefined : t("kpi.answered", { n: last.n })}
        />
      ) : null}
      <p className="text-sm text-muted-foreground">{t("trend.how")}</p>
      <ChartTooltip>
        <LineTrend
          testId="trend-line"
          x={data.points.map((p) => p.cycleName)}
          series={[
            {
              key: data.indicator,
              label: indicator,
              values: data.points.map((p) => p.mean),
              color: "stroke-chart-seq fill-chart-seq",
            },
          ]}
          domain={[1, 5]}
          ticks={[1, 2, 3, 4, 5]}
          fmt={num}
          yTitle={t("trend.yTitle")}
          pointHref={
            drill && drillBase
              ? (_key, i) => ({
                  href: drillHref(
                    {
                      pathname: drillBase.pathname,
                      query: {
                        ...drillBase.query,
                        [DRILL_CYCLE_PARAM]: data.points[i].cycleId,
                      },
                    },
                    drill,
                  ),
                  label: t("trend.drill"),
                })
              : undefined
          }
          hiddenTip={(i) =>
            data.points[i].mean === null
              ? `${data.points[i].cycleName}: ${t("trend.under", { min: data.minGroupSize ?? 0 })}`
              : null
          }
          label={`${t("trend.chartLabel", { indicator, subject })}: ${data.points
            .map(pointText)
            .join(", ")}`}
        />
      </ChartTooltip>
      <TableView
        head={[
          t("trend.cycle"),
          t("distribution.people"),
          t("distribution.average"),
          "1",
          "2",
          "3",
          "4",
          "5",
        ]}
        rows={data.points.map((p) =>
          p.suppressed
            ? [
                p.cycleName,
                t("trend.under", { min: data.minGroupSize ?? 0 }),
                "",
                "",
                "",
                "",
                "",
                "",
              ]
            : [p.cycleName, p.n, num(p.mean!), ...p.counts!],
        )}
      />
    </div>
  );
}
