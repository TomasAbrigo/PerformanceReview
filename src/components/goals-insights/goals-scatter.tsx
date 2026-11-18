import { useTranslations } from "next-intl";
import type {
  GoalIndicatorRow,
  GoalOutlierThresholds,
  Indicator,
} from "@/modules/analytics/goals-insights/types";
import { Scatter, type ScatterRef, useChartFormat } from "@/components/charts";
import { Empty, TableView, useDecimal } from "./shared";

/**
 * Goals completed (share, horizontal) against one indicator (the manager's
 * 1-5 answer, vertical): a dot per person (single hue, translucent so stacked
 * people darken, a tooltip each) and the same points as a table. People
 * without goals or without that answer have no point; they are counted.
 */
export function GoalsScatter({
  rows,
  indicator,
  thresholds,
  hrefFor,
}: {
  rows: GoalIndicatorRow[];
  indicator: Indicator;
  /** Reference lines: the risk threshold and the goals "done" share. */
  thresholds?: GoalOutlierThresholds;
  /** Where a dot leads (the person's assessment); none, no links. */
  hrefFor?: (row: GoalIndicatorRow) => string;
}) {
  const f = useChartFormat();
  const t = useTranslations("GoalsInsights");
  const decimal = useDecimal();
  const name = t(`indicator.${indicator}`);
  const dots = rows.flatMap((r) =>
    r.completedPct !== null && r[indicator] !== null
      ? [{ row: r, x: r.completedPct, y: r[indicator] }]
      : [],
  );
  if (rows.length === 0) return <Empty />;
  const pointLabel = (d: (typeof dots)[number]) =>
    t("scatter.point", {
      name: d.row.name,
      completed: decimal(d.x) ?? 0,
      indicator: name,
      value: d.y,
    });
  const missing = rows.length - dots.length;
  const refs: ScatterRef[] = thresholds
    ? [
        {
          axis: "y",
          value: thresholds.riskThreshold + 0.5,
          label: t("scatter.riskLine", { max: thresholds.riskThreshold }),
        },
        {
          axis: "x",
          value: thresholds.goalsHigh,
          label: t("scatter.goalsLine", { min: thresholds.goalsHigh }),
        },
      ]
    : [];
  return (
    <div className="flex flex-col gap-3" data-testid="scatter-chart">
      <Scatter
        label={`${t("scatter.title", { indicator: name })} (${dots.length})`}
        points={dots.map((d) => ({
          key: d.row.participantId,
          x: d.x,
          y: d.y,
          tip: pointLabel(d),
          href: hrefFor?.(d.row),
        }))}
        xDomain={[0, 100]}
        yDomain={[0.5, 5.5]}
        xTicks={[0, 25, 50, 75, 100]}
        yTicks={[1, 2, 3, 4, 5]}
        xFmt={(v) => f.percent(v)}
        yFmt={(v) => String(v)}
        xTitle={t("scatter.xAxis")}
        yTitle={t("scatter.yAxis", { indicator: name })}
        refs={refs}
      />
      {hrefFor ? (
        <p className="text-sm text-muted-foreground">{t("scatter.open")}</p>
      ) : null}
      {missing > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("scatter.missing", { n: missing })}
        </p>
      ) : null}
      <TableView
        head={[t("people.columns.name"), t("people.columns.completed"), name]}
        rows={dots.map((d) => [d.row.name, decimal(d.x) ?? 0, d.y])}
      />
    </div>
  );
}
