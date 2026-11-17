import { useFormatter, useTranslations } from "next-intl";
import { Empty, TableView } from "@/components/dashboards/parts";
import type { IndicatorTrend } from "@/modules/analytics/indicators/types";

const W = 480;
const H = 200;
const PAD = { l: 32, r: 16, t: 12, b: 32 };

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
  const n = data.points.length;
  const x = (i: number) =>
    PAD.l +
    (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v: number) => PAD.t + ((5 - v) / 4) * (H - PAD.t - PAD.b);
  const known = data.points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.mean !== null);
  const path = known
    .map(({ p, i }, k) => `${k ? "L" : "M"}${x(i)},${y(p.mean!)}`)
    .join(" ");
  const pointText = (p: IndicatorTrend["points"][number]) =>
    t("trend.point", {
      cycle: p.cycleName,
      value: p.mean === null ? t("trend.hidden") : num(p.mean),
    });
  return (
    <div className="flex flex-col gap-3" data-testid="trend-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-xl"
        role="img"
        aria-label={`${t("trend.chartLabel", { indicator, subject })}: ${data.points
          .map(pointText)
          .join(", ")}`}
      >
        {[1, 2, 3, 4, 5].map((g) => (
          <g key={g}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(g)}
              y2={y(g)}
              className="stroke-border"
            />
            <text
              x={PAD.l - 6}
              y={y(g) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {g}
            </text>
          </g>
        ))}
        {known.length > 1 ? (
          <path
            d={path}
            fill="none"
            strokeWidth={2}
            className="stroke-chart-seq"
          />
        ) : null}
        {data.points.map((p, i) => (
          <g key={p.cycleId}>
            <title>{pointText(p)}</title>
            <rect
              x={x(i) - 16}
              y={PAD.t}
              width={32}
              height={H - PAD.t - PAD.b}
              fill="transparent"
            />
            {p.mean !== null ? (
              <circle
                cx={x(i)}
                cy={y(p.mean)}
                r={4}
                strokeWidth={2}
                className="fill-chart-seq stroke-background"
              />
            ) : null}
            <text
              x={x(i)}
              y={H - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {p.cycleName}
            </text>
          </g>
        ))}
      </svg>
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
