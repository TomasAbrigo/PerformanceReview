import { useTranslations } from "next-intl";
import type {
  GoalIndicatorRow,
  Indicator,
} from "@/modules/analytics/goals-insights/types";
import { Empty, TableView, useDecimal } from "./shared";

const W = 360;
const H = 240;
const PAD = { l: 40, r: 12, t: 12, b: 40 };

/**
 * Goals completed (share, horizontal) against one indicator (the manager's
 * 1-5 answer, vertical): a dot per person (single hue, translucent so stacked
 * people darken, a tooltip each) and the same points as a table. People
 * without goals or without that answer have no point; they are counted.
 */
export function GoalsScatter({
  rows,
  indicator,
}: {
  rows: GoalIndicatorRow[];
  indicator: Indicator;
}) {
  const t = useTranslations("GoalsInsights");
  const decimal = useDecimal();
  const name = t(`indicator.${indicator}`);
  const dots = rows.flatMap((r) =>
    r.completedPct !== null && r[indicator] !== null
      ? [{ row: r, x: r.completedPct, y: r[indicator] }]
      : [],
  );
  if (rows.length === 0) return <Empty />;
  const x = (v: number) => PAD.l + (v / 100) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - 1) / 4) * (H - PAD.t - PAD.b);
  const pointLabel = (d: (typeof dots)[number]) =>
    t("scatter.point", {
      name: d.row.name,
      completed: decimal(d.x) ?? 0,
      indicator: name,
      value: d.y,
    });
  const missing = rows.length - dots.length;
  return (
    <div className="flex flex-col gap-3" data-testid="scatter-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-md"
        role="img"
        aria-label={`${t("scatter.title", { indicator: name })} (${dots.length})`}
      >
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
            />
            <text
              x={PAD.l - 6}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {v}
            </text>
          </g>
        ))}
        {[0, 50, 100].map((v) => (
          <text
            key={v}
            x={x(v)}
            y={H - PAD.b + 14}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {v}
          </text>
        ))}
        <text
          x={(W + PAD.l) / 2}
          y={H - 6}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {t("scatter.xAxis")}
        </text>
        <text
          x={10}
          y={(H - PAD.b + PAD.t) / 2}
          textAnchor="middle"
          transform={`rotate(-90 10 ${(H - PAD.b + PAD.t) / 2})`}
          className="fill-muted-foreground text-[10px]"
        >
          {t("scatter.yAxis", { indicator: name })}
        </text>
        {dots.map((d) => (
          <g key={d.row.participantId}>
            <title>{pointLabel(d)}</title>
            <circle cx={x(d.x)} cy={y(d.y)} r={10} fill="transparent" />
            <circle
              cx={x(d.x)}
              cy={y(d.y)}
              r={4}
              strokeWidth={2}
              fillOpacity={0.6}
              className="fill-chart-seq stroke-background"
            />
          </g>
        ))}
      </svg>
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
