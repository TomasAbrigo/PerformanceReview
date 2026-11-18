import { Link } from "@/i18n/navigation";

export type LineSeries = {
  key: string;
  label: string;
  values: (number | null)[];
  /** Tailwind stroke + fill classes (same hue). */
  color: string;
  dash?: string;
};

const W = 640;
const H = 256;
const PAD = { l: 44, r: 64, t: 30, b: 36 };
/** #117: the least room an x label gets, in viewBox units; fewer labels otherwise. */
const MIN_LABEL_SLOT = 64;
const LABEL_LINE = 13;

/**
 * Splits an x label into lines of at most `max` characters, on spaces (a
 * word longer than `max` stays whole), so long cycle names stack instead of
 * running into their neighbours.
 */
export function wrapLabel(label: string, max: number, lines = 3): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/)) {
    if (!line) line = word;
    else if ((line + " " + word).length <= max) line += " " + word;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] += "…";
  return kept;
}

/** One stroke per run of non-null values: a hidden point is a real gap. */
export function linePath(
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
) {
  return values
    .map((v, i) =>
      v === null
        ? null
        : `${i > 0 && values[i - 1] !== null ? "L" : "M"}${x(i)},${y(v)}`,
    )
    .filter(Boolean)
    .join(" ");
}

/**
 * Trend over time: 2px lines on a fixed y-scale (0-100 % or the real 1-5
 * scale), light gridlines, the last point of each series labelled with its
 * value, hidden points left as gaps with a shaded column that says why, and
 * a focusable point per value with its tooltip.
 */
export function LineTrend({
  x,
  series,
  domain,
  ticks,
  fmt,
  label,
  yTitle,
  hiddenTip,
  testId = "line-trend",
  pointHref,
  endLabels = "value",
}: {
  /** #117: a point opens this (app path, no locale) with this name; null: not. */
  pointHref?: (
    seriesKey: string,
    i: number,
  ) => { href: string; label: string } | null;
  /** #117: "series" writes the series name beside the last value. */
  endLabels?: "value" | "series";
  /** Labels of the x positions (cycles, months). */
  x: string[];
  series: LineSeries[];
  domain: [number, number];
  ticks: number[];
  /** Value -> text (tick labels, last-point label, tooltips). */
  fmt: (v: number) => string;
  label: string;
  /** y-axis title with the unit ("Promedio (1–5)"). */
  yTitle: string;
  /** Tooltip of an x position where every series is hidden. */
  hiddenTip?: (i: number) => string | null;
  testId?: string;
}) {
  const n = x.length;
  const padR = endLabels === "series" ? 150 : PAD.r;
  const plotW = W - PAD.l - padR;
  const xOf = (i: number) =>
    PAD.l + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const yOf = (v: number) =>
    PAD.t + ((domain[1] - v) / (domain[1] - domain[0])) * (H - PAD.t - PAD.b);
  // Last-point labels, nudged apart when they would collide.
  const ends = series
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && s.values[i] === null) i--;
      return i < 0 ? null : { s, i, v: s.values[i]!, y: yOf(s.values[i]!) };
    })
    .filter((e) => e !== null)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++)
    if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
  // Every `step`-th label (and the last), so that each has room.
  const gap = n <= 1 ? plotW : plotW / (n - 1);
  const step = Math.max(1, Math.ceil(MIN_LABEL_SLOT / gap));
  // Characters that fit between two shown labels at 11px, at least a word.
  const slot = gap * step;
  const maxChars = Math.max(8, Math.floor(slot / 6.2));
  const labels = x.map((lbl) => wrapLabel(lbl, maxChars));
  // The first label starts at its point, so it never runs off the left edge.
  const labelX = (i: number) => (i === 0 && n > 1 ? xOf(0) - 8 : xOf(i));
  const labelLines = Math.max(1, ...labels.map((l) => l.length));
  const height = H + (labelLines - 1) * LABEL_LINE;
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full max-w-[640px]"
      role="group"
      aria-label={label}
      data-testid={testId}
    >
      <text x={4} y={14} className="fill-muted-foreground text-[12px]">
        {yTitle}
      </text>
      {ticks.map((g) => (
        <g key={g} aria-hidden="true">
          <line
            x1={PAD.l}
            x2={W - padR}
            y1={yOf(g)}
            y2={yOf(g)}
            className="stroke-border"
            strokeOpacity={0.6}
          />
          <text
            x={PAD.l - 6}
            y={yOf(g) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[12px] tabular-nums"
          >
            {fmt(g)}
          </text>
        </g>
      ))}
      {x.map((_lbl, i) => {
        const tip = hiddenTip?.(i);
        return (
          <g key={`x-${i}`}>
            {tip ? (
              <rect
                x={xOf(i) - 10}
                y={PAD.t}
                width={20}
                height={H - PAD.t - PAD.b}
                className="fill-muted"
                data-tip={tip}
                tabIndex={0}
                role="img"
                aria-label={tip}
              />
            ) : null}
            {(i % step === 0 && (i === n - 1 || n - 1 - i >= step)) ||
            i === n - 1 ? (
              <text
                x={labelX(i)}
                y={H - 12}
                textAnchor={i === 0 && n > 1 ? "start" : "middle"}
                className="fill-muted-foreground text-[11px]"
                aria-hidden="true"
              >
                {labels[i].map((line, k) => (
                  <tspan key={k} x={labelX(i)} dy={k === 0 ? 0 : LABEL_LINE}>
                    {line}
                  </tspan>
                ))}
              </text>
            ) : null}
          </g>
        );
      })}
      {series.map((s) => (
        <g key={s.key} className={s.color} data-series={s.key}>
          <path
            d={linePath(s.values, xOf, yOf)}
            fill="none"
            strokeWidth={2}
            strokeDasharray={s.dash}
            data-testid={`${testId}-path`}
          />
          {s.values.map((v, i) => {
            if (v === null) return null;
            const link = pointHref?.(s.key, i);
            const dot = (
              <>
                <circle
                  cx={xOf(i)}
                  cy={yOf(v)}
                  r={10}
                  fill="transparent"
                  stroke="none"
                />
                <circle
                  cx={xOf(i)}
                  cy={yOf(v)}
                  r={link ? 5 : 4}
                  strokeWidth={2}
                  className="stroke-background"
                />
              </>
            );
            if (link) {
              return (
                <Link
                  key={i}
                  href={link.href}
                  scroll={false}
                  aria-haspopup="dialog"
                  aria-label={`${s.label} · ${x[i]}: ${fmt(v)} · ${link.label}`}
                  data-tip={`${s.label} · ${x[i]}: ${fmt(v)} · ${link.label}`}
                  data-testid={`${testId}-point`}
                  className="cursor-pointer outline-none [&:focus-visible>circle:last-child]:stroke-ring"
                >
                  {dot}
                </Link>
              );
            }
            return (
              <g
                key={i}
                tabIndex={0}
                role="img"
                aria-label={`${s.label} · ${x[i]}: ${fmt(v)}`}
                data-tip={`${s.label} · ${x[i]}: ${fmt(v)}`}
                className="outline-none [&:focus-visible>circle:last-child]:stroke-ring"
              >
                <circle
                  cx={xOf(i)}
                  cy={yOf(v)}
                  r={10}
                  fill="transparent"
                  stroke="none"
                />
                <circle
                  cx={xOf(i)}
                  cy={yOf(v)}
                  r={4}
                  strokeWidth={2}
                  className="stroke-background"
                />
              </g>
            );
          })}
        </g>
      ))}
      {ends.map((e) => (
        <text
          key={e.s.key}
          x={xOf(e.i) + 10}
          y={e.y + 4}
          className="fill-foreground text-[12px] font-semibold tabular-nums"
          data-testid={`${testId}-last`}
        >
          {endLabels === "series" ? `${e.s.label} ${fmt(e.v)}` : fmt(e.v)}
        </text>
      ))}
    </svg>
  );
}
