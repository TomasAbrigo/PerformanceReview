import { useFormatter, useTranslations } from "next-intl";
import { ChartTooltip, LineTrend } from "@/components/charts";
import { Empty, TableView } from "@/components/insights/parts";
import type { IndicatorTrend } from "@/modules/analytics/indicators/types";

/**
 * One indicator (1-5) cycle by cycle: a 2px line through the means (the value
 * itself for a person), 8px markers, a recessive grid at each value, a tooltip
 * per point and a table with n and the count of each value. Cycles that
 * direction cannot see (under the minimum) leave a gap.
 */
export function TrendChart({
  data,
  subject,
}: {
  data: IndicatorTrend;
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
  return (
    <div className="flex flex-col gap-3" data-testid="trend-chart">
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
