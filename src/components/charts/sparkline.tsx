import { linePath } from "./line-trend";

const W = 160;
const H = 44;
const PAD = { l: 4, r: 30, t: 8, b: 8 };

/**
 * A word-sized trend: a 1.5px line on the given domain, the min and max
 * marked as small dots, the last value as a bigger dot with its value
 * written next to it. Several series share the box (told apart by dash).
 */
export function Sparkline({
  series,
  domain,
  fmt,
  label,
}: {
  series: {
    key: string;
    values: (number | null)[];
    color: string;
    dash?: string;
  }[];
  domain: [number, number];
  fmt: (v: number) => string;
  label: string;
}) {
  const n = Math.max(...series.map((s) => s.values.length));
  const plotW = W - PAD.l - PAD.r;
  const xOf = (i: number) =>
    PAD.l + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const yOf = (v: number) =>
    PAD.t + ((domain[1] - v) / (domain[1] - domain[0])) * (H - PAD.t - PAD.b);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-11 w-40"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {series.map((s) => {
        const vals = s.values
          .map((v, i) => ({ v, i }))
          .filter((p): p is { v: number; i: number } => p.v !== null);
        if (!vals.length) return null;
        const last = vals[vals.length - 1];
        const min = vals.reduce((a, b) => (b.v < a.v ? b : a));
        const max = vals.reduce((a, b) => (b.v > a.v ? b : a));
        // Isolated points (no neighbour) still show as dots.
        const lonely = vals.filter(
          (p) =>
            (p.i === 0 || s.values[p.i - 1] === null) &&
            (p.i === s.values.length - 1 || s.values[p.i + 1] === null),
        );
        return (
          <g key={s.key} className={s.color} data-series={s.key}>
            {linePath(s.values, xOf, yOf).includes("L") ? (
              <path
                d={linePath(s.values, xOf, yOf)}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray={s.dash}
              />
            ) : null}
            {lonely.map((p) => (
              <circle
                key={`l${p.i}`}
                cx={xOf(p.i)}
                cy={yOf(p.v)}
                r={2}
                strokeWidth={0}
              />
            ))}
            {vals.length > 2 && min.i !== last.i ? (
              <circle
                cx={xOf(min.i)}
                cy={yOf(min.v)}
                r={2}
                className="fill-background"
                strokeWidth={1}
                data-mark="min"
              />
            ) : null}
            {vals.length > 2 && max.i !== last.i && max.i !== min.i ? (
              <circle
                cx={xOf(max.i)}
                cy={yOf(max.v)}
                r={2}
                className="fill-background"
                strokeWidth={1}
                data-mark="max"
              />
            ) : null}
            <circle
              cx={xOf(last.i)}
              cy={yOf(last.v)}
              r={3}
              strokeWidth={0}
              data-mark="last"
            />
          </g>
        );
      })}
      {series.map((s, k) => {
        const vals = s.values.filter((v): v is number => v !== null);
        if (!vals.length) return null;
        const v = vals[vals.length - 1];
        return (
          <text
            key={s.key}
            x={W - PAD.r + 4}
            y={Math.min(
              H - 2,
              Math.max(12, yOf(v) + 4 + k * (series.length > 1 ? 6 : 0)),
            )}
            className="fill-foreground text-[12px] tabular-nums"
          >
            {fmt(v)}
          </text>
        );
      })}
    </svg>
  );
}
