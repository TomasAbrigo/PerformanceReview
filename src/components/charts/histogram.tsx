import { useChartFormat } from "./format";

export type HistogramBin = {
  key: string;
  /** Label under the bar (the bin). */
  tick: string;
  count: number;
  /** Tooltip / accessible name of the bar. */
  tip: string;
};

const H = 96;

/**
 * A histogram as HTML columns: one sequential hue, bars anchored to the
 * baseline, the count and the share of n written above each bar, the bin
 * under it, a focusable bar with its tooltip. `max` is shared by small
 * multiples so their heights compare.
 */
export function Histogram({
  bins,
  max,
  label,
  xTitle,
}: {
  bins: HistogramBin[];
  max: number;
  label: string;
  xTitle?: string;
}) {
  const f = useChartFormat();
  const n = bins.reduce((a, b) => a + b.count, 0);
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <div
        className="flex items-end gap-1.5 border-b border-border"
        style={{ height: H + 34 }}
      >
        {bins.map((b) => {
          const h = b.count ? Math.max(4, (b.count / Math.max(1, max)) * H) : 0;
          return (
            <div
              key={b.key}
              className="flex w-12 flex-col items-center justify-end gap-0.5"
            >
              <span className="text-xs font-medium tabular-nums">
                {b.count}
              </span>
              <span className="text-[11px] leading-none text-muted-foreground tabular-nums">
                {n ? f.share(b.count / n) : ""}
              </span>
              <span
                role="img"
                aria-label={b.tip}
                data-tip={b.tip}
                tabIndex={0}
                data-testid="histogram-bar"
                className="w-9 rounded-t-[4px] bg-chart-seq outline-offset-1 focus-visible:outline-2 focus-visible:outline-ring"
                style={{ height: h }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {bins.map((b) => (
          <span
            key={b.key}
            className="w-12 text-center text-xs text-muted-foreground tabular-nums"
          >
            {b.tick}
          </span>
        ))}
      </div>
      {xTitle ? (
        <span className="text-xs text-muted-foreground">{xTitle}</span>
      ) : null}
    </div>
  );
}
