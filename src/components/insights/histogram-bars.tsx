const BAR_W = 28;
const GAP = 8;
const H = 96;

export type HistogramBar = {
  key: string | number;
  count: number;
  /** Hover tooltip of the bar. */
  title: string;
  /** Tick under the bar. */
  tick: string | number;
};

/**
 * One histogram (dataviz skill): single sequential hue, bars anchored to the
 * baseline with 4px rounded tops (min height 4), direct count labels, a
 * hit target bigger than the mark and a tooltip per bar. `max` is shared
 * across small multiples. Used by the calibration and dashboard charts.
 */
export function HistogramBars({
  bars,
  max,
  label,
}: {
  bars: HistogramBar[];
  max: number;
  label: string;
}) {
  const width = bars.length * (BAR_W + GAP);
  return (
    <svg width={width} height={H + 32} role="img" aria-label={label}>
      <line
        x1={0}
        x2={width}
        y1={H + 14}
        y2={H + 14}
        className="stroke-border"
      />
      {bars.map((b, i) => {
        const h = (b.count / Math.max(1, max)) * H;
        const bar = Math.max(h, 4);
        const x = i * (BAR_W + GAP) + GAP / 2;
        return (
          <g key={b.key}>
            <title>{b.title}</title>
            <rect
              x={x - GAP / 2}
              y={0}
              width={BAR_W + GAP}
              height={H + 30}
              fill="transparent"
            />
            {b.count > 0 ? (
              <path
                className="fill-chart-seq"
                d={`M${x},${H + 14} v${-(bar - 4)} q0,-4 4,-4 h${BAR_W - 8} q4,0 4,4 v${bar - 4} z`}
              />
            ) : null}
            <text
              x={x + BAR_W / 2}
              y={H + 10 - (b.count > 0 ? bar : 0)}
              textAnchor="middle"
              className="fill-foreground text-[11px] tabular-nums"
            >
              {b.count}
            </text>
            <text
              x={x + BAR_W / 2}
              y={H + 28}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {b.tick}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
