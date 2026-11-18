import { useFormatter, useTranslations } from "next-intl";
import type { Dm360Point } from "@/modules/analytics/dm-360/types";

const W = 140;
const H = 40;
const PAD = 4;

/** x of the i-th of n points, spread over the width. */
const xOf = (i: number, n: number) =>
  n <= 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1);
/** y of a 1-5 value: 5 at the top. */
const yOf = (value: number) => PAD + ((5 - value) / 4) * (H - 2 * PAD);

/** `M x y L x y ...` for each run of consecutive points that have a value. */
function runs(values: (number | null)[]): {
  path: string;
  dots: [number, number][];
} {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push([xOf(i, values.length), yOf(v)]);
  });
  if (current.length) segments.push(current);
  return {
    path: segments
      .filter((s) => s.length > 1)
      .map((s) => s.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" "))
      .join(" "),
    dots: segments.filter((s) => s.length === 1).map((s) => s[0]),
  };
}

/**
 * The retention (solid line) and engagement (dashed line) means of a card
 * over the latest cycles, on the 1-5 scale, as an inline SVG: no chart
 * library, no color-only cue (the two lines differ in dash and the last value
 * of each is a dot), and a text twin for assistive technology.
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
  const series = [
    {
      key: "retention" as const,
      className: "stroke-chart-seq fill-chart-seq",
      dash: undefined,
    },
    {
      key: "engagement" as const,
      className: "stroke-chart-sent-mixed fill-chart-sent-mixed",
      dash: "4 3",
    },
  ];
  const text = series
    .map(
      ({ key }) =>
        `${t(key)}: ${points
          .map((p) => t("point", { cycle: p.cycleName, value: num(p[key]) }))
          .join(", ")}`,
    )
    .join(". ");
  const last = points.length - 1;
  return (
    <figure className="flex flex-col gap-1" data-testid="dm-sparkline">
      <svg
        role="img"
        aria-label={`${t("label")}. ${text}`}
        viewBox={`0 0 ${W} ${H}`}
        className="h-10 w-36"
      >
        <title>{t("label")}</title>
        {series.map(({ key, className, dash }) => {
          const values = points.map((p) => p[key]);
          const { path, dots } = runs(values);
          const end = values[last];
          return (
            <g key={key} className={className} data-series={key}>
              {path ? (
                <path
                  d={path}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={dash}
                />
              ) : null}
              {dots.map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r={2} strokeWidth={0} />
              ))}
              {end !== null && end !== undefined ? (
                <circle
                  cx={xOf(last, values.length)}
                  cy={yOf(end)}
                  r={2.5}
                  strokeWidth={0}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{text}</figcaption>
    </figure>
  );
}
