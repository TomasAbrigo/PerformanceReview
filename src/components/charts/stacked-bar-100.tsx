import { useTranslations } from "next-intl";
import { useChartFormat } from "./format";

export type StackSeries = {
  key: string;
  label: string;
  /** Tailwind bg class of the segment. */
  fill: string;
  /** Text class readable on that fill. */
  ink: string;
};

export type StackRow = {
  key: string;
  label: string;
  values: Record<string, number>;
  /** Why the row has no bar (e.g. under the minimum group size). */
  masked?: string;
  testId?: string;
  /** Native tooltip of the whole row (all its numbers). */
  title?: string;
};

const total = (r: StackRow, keys: string[]) =>
  keys.reduce((n, k) => n + (r.values[k] ?? 0), 0);

/**
 * Rows ordered by the share of `sortBy` series (descending: most at risk
 * first); masked rows last; ties keep their input order.
 */
export function orderRows(
  rows: StackRow[],
  series: StackSeries[],
  sortBy?: string[],
): StackRow[] {
  if (!sortBy?.length) return rows;
  const keys = series.map((s) => s.key);
  const share = (r: StackRow) => {
    const all = total(r, keys);
    return r.masked || !all ? -1 : total(r, sortBy) / all;
  };
  return rows
    .map((r, i) => ({ r, i, s: share(r) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

/** Below this share a segment carries no inner label (the tooltip and table do). */
const LABEL_MIN = 0.12;

/**
 * 100% stacked horizontal bars: one row per group, segments in the series
 * order (= legend order) with their percent inside when wide enough, n at
 * the end, a tooltip per segment (hover and keyboard focus).
 */
export function StackedBar100({
  rows,
  series,
  sortBy,
  label,
  compact = false,
}: {
  rows: StackRow[];
  series: StackSeries[];
  sortBy?: string[];
  /** Accessible name of the chart. */
  label: string;
  /** One thin bar, no row label nor n (a list row). */
  compact?: boolean;
}) {
  const t = useTranslations("Charts");
  const f = useChartFormat();
  const keys = series.map((s) => s.key);
  const ordered = orderRows(rows, series, sortBy);
  return (
    <div
      role="group"
      aria-label={label}
      className={
        compact ? "w-full max-w-xs" : "flex w-full max-w-4xl flex-col gap-2"
      }
    >
      {ordered.map((r) => {
        const n = total(r, keys);
        return (
          <div
            key={r.key}
            data-testid={r.testId ?? "stack-row"}
            title={r.title}
            className={
              compact
                ? ""
                : "grid grid-cols-[minmax(8rem,18rem)_1fr_4rem] items-center gap-3"
            }
          >
            {compact ? null : (
              <span
                className="line-clamp-2 text-sm leading-tight"
                title={r.label}
              >
                {r.label}
              </span>
            )}
            {r.masked || n === 0 ? (
              <span className="text-xs text-muted-foreground">
                {r.masked ?? t("noData")}
              </span>
            ) : (
              <div
                className={`flex w-full gap-0.5 overflow-hidden rounded-sm ${compact ? "h-2" : "h-7"}`}
              >
                {series.map((s) => {
                  const v = r.values[s.key] ?? 0;
                  if (!v) return null;
                  const share = v / n;
                  const tip = t("segmentTip", {
                    row: r.label,
                    series: s.label,
                    count: v,
                    share: f.share(share),
                  });
                  return (
                    <span
                      key={s.key}
                      data-segment={s.key}
                      data-tip={tip}
                      aria-label={tip}
                      role="img"
                      tabIndex={compact ? undefined : 0}
                      style={{ width: `${share * 100}%` }}
                      className={`flex min-w-0 items-center justify-center text-xs font-medium tabular-nums outline-offset-1 focus-visible:outline-2 focus-visible:outline-ring ${s.fill} ${s.ink}`}
                    >
                      {!compact && share >= LABEL_MIN ? f.share(share) : null}
                    </span>
                  );
                })}
              </div>
            )}
            {compact ? null : (
              <span className="text-right text-xs text-muted-foreground tabular-nums">
                {r.masked ? "" : t("nShort", { n })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
