import { useTranslations } from "next-intl";
import type { PersonTrajectory } from "@/modules/analytics/dashboards/types";
import { Empty, pct, TableView } from "./parts";

const W = 480;
const H = 180;
const PAD = { l: 36, r: 16, t: 12, b: 28 };

/**
 * Normalized rating per cycle (change over time): one 2px line in the
 * sequential hue, 8px markers with a 2px surface ring, recessive 0/50/100
 * grid, a tooltip per point and a table with the manager and job title of
 * each moment. Unpublished ratings (employee view) leave a gap.
 */
export function TrajectoryChart({ data }: { data: PersonTrajectory }) {
  const t = useTranslations("Dashboards");
  if (!data.points.length) return <Empty />;
  const n = data.points.length;
  const x = (i: number) =>
    PAD.l +
    (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
  const y = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);
  const pts = data.points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.normalized !== null);
  const path = pts
    .map(({ p, i }, k) => `${k ? "L" : "M"}${x(i)},${y(p.normalized!)}`)
    .join(" ");
  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-xl"
        role="img"
        aria-label={`${t("trajectory.chartLabel")}: ${data.points
          .map((p) =>
            t("trajectory.point", {
              cycle: p.cycleName,
              value:
                p.normalized === null
                  ? t("trajectory.hidden")
                  : `${pct(p.normalized)} %`,
            }),
          )
          .join(", ")}`}
      >
        {[0, 0.5, 1].map((g) => (
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
              {g * 100}
            </text>
          </g>
        ))}
        {pts.length > 1 ? (
          <path
            d={path}
            fill="none"
            strokeWidth={2}
            className="stroke-chart-seq"
          />
        ) : null}
        {data.points.map((p, i) => (
          <g key={p.cycleId}>
            <title>
              {t("trajectory.point", {
                cycle: p.cycleName,
                value:
                  p.normalized === null
                    ? t("trajectory.hidden")
                    : `${pct(p.normalized)} %`,
              })}
            </title>
            <rect
              x={x(i) - 16}
              y={PAD.t}
              width={32}
              height={H - PAD.t - PAD.b}
              fill="transparent"
            />
            {p.normalized !== null ? (
              <circle
                cx={x(i)}
                cy={y(p.normalized)}
                r={4}
                strokeWidth={2}
                className="fill-chart-seq stroke-background"
              />
            ) : null}
            <text
              x={x(i)}
              y={H - 8}
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
          t("trajectory.cycle"),
          t("trajectory.rating"),
          t("trajectory.manager"),
          t("trajectory.jobTitle"),
        ]}
        rows={data.points.map((p) => [
          p.cycleName,
          p.normalized === null
            ? t("trajectory.hidden")
            : `${pct(p.normalized)} %${p.optionLabel ? ` (${p.optionLabel})` : ""}`,
          p.managerName ?? t("none"),
          p.jobTitle ?? t("none"),
        ])}
      />
    </div>
  );
}
