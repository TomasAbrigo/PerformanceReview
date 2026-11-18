export type ScatterPoint = { key: string; x: number; y: number; tip: string };

export type ScatterRef = {
  axis: "x" | "y";
  value: number;
  label: string;
};

const W = 560;
const H = 320;
const PAD = { l: 52, r: 16, t: 24, b: 48 };
/** Inner margin so dots at the domain edge do not cover the tick labels. */
const INSET = 16;

/**
 * A scatter plot: one translucent dot per point (overlaps darken; identical
 * coordinates spread slightly so each stays reachable), axis titles with
 * units, light gridlines, dashed reference lines (e.g. the risk threshold)
 * with their label, and a focusable point with its tooltip.
 */
export function Scatter({
  points,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  xFmt,
  yFmt,
  xTitle,
  yTitle,
  refs = [],
  label,
}: {
  points: ScatterPoint[];
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: number[];
  yTicks: number[];
  xFmt: (v: number) => string;
  yFmt: (v: number) => string;
  xTitle: string;
  yTitle: string;
  refs?: ScatterRef[];
  label: string;
}) {
  const x = (v: number) =>
    PAD.l +
    INSET +
    ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) *
      (W - PAD.l - PAD.r - 2 * INSET);
  const y = (v: number) =>
    PAD.t +
    (1 - (v - yDomain[0]) / (yDomain[1] - yDomain[0])) * (H - PAD.t - PAD.b);
  // Spread points sharing a position on a small ring.
  const seen = new Map<string, number>();
  const placed = points.map((p) => {
    const k = `${p.x}|${p.y}`;
    const i = seen.get(k) ?? 0;
    seen.set(k, i + 1);
    const a = i * 2.4;
    const r = 2.2 * Math.sqrt(i);
    return { p, cx: x(p.x) + Math.cos(a) * r, cy: y(p.y) + Math.sin(a) * r };
  });
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[560px]"
      role="group"
      aria-label={label}
      data-testid="scatter"
    >
      {yTicks.map((v) => (
        <g key={`y${v}`} aria-hidden="true">
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(v)}
            y2={y(v)}
            className="stroke-border"
            strokeOpacity={0.6}
          />
          <text
            x={PAD.l - 6}
            y={y(v) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[12px] tabular-nums"
          >
            {yFmt(v)}
          </text>
        </g>
      ))}
      {xTicks.map((v) => (
        <text
          key={`x${v}`}
          x={x(v)}
          y={H - PAD.b + 16}
          textAnchor="middle"
          className="fill-muted-foreground text-[12px] tabular-nums"
          aria-hidden="true"
        >
          {xFmt(v)}
        </text>
      ))}
      <text
        x={(W + PAD.l) / 2}
        y={H - 8}
        textAnchor="middle"
        className="fill-foreground text-[12px] font-medium"
      >
        {xTitle} →
      </text>
      <text x={4} y={14} className="fill-foreground text-[12px] font-medium">
        ↑ {yTitle}
      </text>
      {refs.map((r) =>
        r.axis === "y" ? (
          <g key={`ry${r.value}`} data-testid="scatter-ref">
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(r.value)}
              y2={y(r.value)}
              className="stroke-chart-div-neg"
              strokeDasharray="5 4"
              strokeWidth={1.5}
            />
            <text
              x={W - PAD.r}
              y={y(r.value) + 14}
              textAnchor="end"
              className="fill-foreground text-[12px]"
            >
              {r.label}
            </text>
          </g>
        ) : (
          <g key={`rx${r.value}`} data-testid="scatter-ref">
            <line
              x1={x(r.value)}
              x2={x(r.value)}
              y1={PAD.t}
              y2={H - PAD.b}
              className="stroke-foreground/50"
              strokeDasharray="5 4"
              strokeWidth={1.5}
            />
            <text
              x={x(r.value) + (x(r.value) > W / 2 ? -4 : 4)}
              y={PAD.t + 10}
              textAnchor={x(r.value) > W / 2 ? "end" : "start"}
              className="fill-foreground text-[12px]"
            >
              {r.label}
            </text>
          </g>
        ),
      )}
      {placed.map(({ p, cx, cy }) => (
        <g
          key={p.key}
          tabIndex={0}
          role="img"
          aria-label={p.tip}
          data-tip={p.tip}
          className="outline-none [&:focus-visible>circle:last-child]:stroke-ring"
        >
          <title>{p.tip}</title>
          <circle cx={cx} cy={cy} r={10} fill="transparent" />
          <circle
            cx={cx}
            cy={cy}
            r={4.5}
            strokeWidth={1.5}
            fillOpacity={0.55}
            className="fill-chart-seq stroke-background"
          />
        </g>
      ))}
    </svg>
  );
}
