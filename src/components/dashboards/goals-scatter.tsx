import { useTranslations } from "next-intl";
import type { GoalsVsRatingRow } from "@/modules/analytics/dashboards/types";
import { Empty, pct, TableView } from "./parts";

const W = 360;
const H = 220;
const PAD = { l: 40, r: 12, t: 12, b: 36 };

/**
 * Goals of the period vs final rating: one dot per person (8px, surface
 * ring, single hue), x = average goal progress, y = normalized rating, a
 * tooltip per dot and the full table (people without goals included).
 */
export function GoalsScatter({ rows }: { rows: GoalsVsRatingRow[] }) {
  const t = useTranslations("Dashboards");
  if (!rows.length) return <Empty />;
  const x = (v: number) => PAD.l + (v / 100) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);
  const dots = rows.filter(
    (r) => r.avgProgress !== null && r.normalized !== null,
  );
  const pointLabel = (r: GoalsVsRatingRow) =>
    t("goals.point", {
      name: r.name,
      progress: r.avgProgress ?? 0,
      rating: pct(r.normalized) ?? 0,
    });
  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-md"
        role="img"
        aria-label={`${t("goals.title")}: ${dots.map(pointLabel).join(", ")}`}
      >
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(g / 100)}
              y2={y(g / 100)}
              className="stroke-border"
            />
            <text
              x={PAD.l - 6}
              y={y(g / 100) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {g}
            </text>
            <text
              x={x(g)}
              y={H - 20}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {g}
            </text>
          </g>
        ))}
        <text
          x={(W + PAD.l) / 2}
          y={H - 4}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {t("goals.xAxis")}
        </text>
        {dots.map((r) => (
          <g key={r.participantId}>
            <title>{pointLabel(r)}</title>
            <circle
              cx={x(r.avgProgress!)}
              cy={y(r.normalized!)}
              r={10}
              fill="transparent"
            />
            <circle
              cx={x(r.avgProgress!)}
              cy={y(r.normalized!)}
              r={4}
              strokeWidth={2}
              className="fill-chart-seq stroke-background"
            />
          </g>
        ))}
      </svg>
      <TableView
        head={[
          t("team.member"),
          t("goals.goals"),
          t("goals.completed"),
          t("goals.progress"),
          t("goals.rating"),
        ]}
        rows={rows.map((r) => [
          r.name,
          r.goals,
          r.completed,
          r.avgProgress === null ? "—" : `${r.avgProgress} %`,
          r.normalized === null ? "—" : `${pct(r.normalized)} %`,
        ])}
      />
    </div>
  );
}
