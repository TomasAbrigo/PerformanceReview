import { useFormatter, useTranslations } from "next-intl";
import type { Dm360Point } from "@/modules/analytics/dm-360/types";

const W = 220;
const H = 72;
const PAD = { l: 16, r: 6, t: 8, b: 16 };
const y = (v: number) => PAD.t + ((5 - v) / 4) * (H - PAD.t - PAD.b);

/**
 * The retention and engagement means of a card over the latest cycles as two
 * small multiples on the same 1-5 scale (gridlines at 1, 3 and 5), the first
 * and last cycle under the axis and the latest value written at the end of
 * each line, with a text twin for assistive technology. Inline SVG.
 */
export function Sparkline({ points }: { points: Dm360Point[] }) {
  const t = useTranslations("Insights360.spark");
  const format = useFormatter();
  const num = (v: number | null) =>
    v === null
      ? t("noData")
      : format.number(v, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
  const when = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  const keys = ["retention", "engagement"] as const;
  const text = keys
    .map(
      (key) =>
        `${t(key)}: ${points
          .map((p) => t("point", { cycle: p.cycleName, value: num(p[key]) }))
          .join(", ")}`,
    )
    .join(". ");
  const x = (i: number) =>
    points.length < 2
      ? (PAD.l + W - PAD.r) / 2
      : PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  return (
    <figure className="flex flex-col gap-1" data-testid="dm-sparkline">
      <div
        className="grid grid-cols-2 gap-3"
        data-testid="dm-spark-multiples"
        role="img"
        aria-label={`${t("label")}. ${text}`}
      >
        {keys.map((key) => {
          const vals = points.map((p, i) => ({ i, v: p[key] }));
          const shown = vals.filter(
            (p): p is { i: number; v: number } => p.v !== null,
          );
          const last = shown.at(-1);
          // A cycle without a value breaks the line: a segment only joins
          // consecutive cycles.
          const path = shown
            .map(
              (p, j) =>
                `${j && shown[j - 1].i === p.i - 1 ? "L" : "M"}${x(p.i)},${y(p.v)}`,
            )
            .join(" ");
          const hasSegment = shown.some(
            (p, j) => j > 0 && shown[j - 1].i === p.i - 1,
          );
          return (
            <div key={key} className="flex flex-col gap-0.5">
              <span className="flex justify-between text-xs">
                <span>{t(key)}</span>
                <span className="font-medium tabular-nums">
                  {last ? num(last.v) : t("noData")}
                </span>
              </span>
              <svg
                data-series={key}
                viewBox={`0 0 ${W} ${H}`}
                className="h-auto w-full overflow-visible"
                aria-hidden="true"
              >
                {[1, 3, 5].map((g) => (
                  <g key={g}>
                    <line
                      x1={PAD.l}
                      x2={W - PAD.r}
                      y1={y(g)}
                      y2={y(g)}
                      className="stroke-border"
                      strokeWidth={1}
                    />
                    <text
                      x={PAD.l - 4}
                      y={y(g) + 3}
                      textAnchor="end"
                      className="fill-muted-foreground text-[9px]"
                    >
                      {g}
                    </text>
                  </g>
                ))}
                {hasSegment ? (
                  <path
                    d={path}
                    fill="none"
                    strokeWidth={2}
                    className={
                      key === "retention"
                        ? "stroke-chart-seq"
                        : "stroke-chart-sent-mixed"
                    }
                  />
                ) : null}
                {shown.map((p) => (
                  <circle
                    key={p.i}
                    cx={x(p.i)}
                    cy={y(p.v)}
                    r={p === last ? 3.5 : 2}
                    className={
                      key === "retention"
                        ? "fill-chart-seq"
                        : "fill-chart-sent-mixed"
                    }
                  />
                ))}
                {points.length > 0 ? (
                  <>
                    <text
                      x={x(0)}
                      y={H - 2}
                      textAnchor={points.length > 1 ? "start" : "middle"}
                      className="fill-muted-foreground text-[9px]"
                    >
                      {when(points[0].periodStart)}
                    </text>
                    {points.length > 1 ? (
                      <text
                        x={x(points.length - 1)}
                        y={H - 2}
                        textAnchor="end"
                        className="fill-muted-foreground text-[9px]"
                      >
                        {when(points.at(-1)!.periodStart)}
                      </text>
                    ) : null}
                  </>
                ) : null}
              </svg>
            </div>
          );
        })}
      </div>
      <figcaption className="sr-only">{text}</figcaption>
    </figure>
  );
}
