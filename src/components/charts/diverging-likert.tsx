import { useTranslations } from "next-intl";
import { useChartFormat } from "./format";

export type LikertRow = {
  key: string;
  label: string;
  /** Counts of the answers 1..5. */
  counts: number[];
  mean?: number | null;
  /** Emphasised (e.g. the "Todos" total row). */
  strong?: boolean;
  testId?: string;
};

/** Low (1-2) to high (4-5), neutral gray at 3: two hues and a gray midpoint. */
const FILL = [
  "bg-chart-div-neg text-white",
  "bg-chart-div-neg-2 text-foreground",
  "bg-chart-sent-neutral text-foreground",
  "bg-chart-div-pos-2 text-foreground",
  "bg-chart-div-pos text-white",
];
export const LIKERT_SWATCH = [
  "bg-chart-div-neg",
  "bg-chart-div-neg-2",
  "bg-chart-sent-neutral",
  "bg-chart-div-pos-2",
  "bg-chart-div-pos",
];

const share = (c: number[], from: number, to: number) => {
  const n = c.reduce((a, b) => a + b, 0);
  return n ? c.slice(from, to).reduce((a, b) => a + b, 0) / n : 0;
};
export const lowShare = (c: number[]) => share(c, 0, 2);
export const highShare = (c: number[]) => share(c, 3, 5);

/** Rows with the biggest low (1-2) share first; strong rows stay on top. */
export function orderLikert(rows: LikertRow[]): LikertRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        Number(!!b.r.strong) - Number(!!a.r.strong) ||
        lowShare(b.r.counts) - lowShare(a.r.counts) ||
        a.i - b.i,
    )
    .map((x) => x.r);
}

/**
 * Likert 1-5 as diverging bars centered on the neutral answer: low answers
 * extend left of the center line, high ones right, 3 straddles it. Each side
 * carries its total share as a direct label; each segment a tooltip.
 */
export function DivergingLikert({
  rows,
  label,
  valueLabels,
}: {
  rows: LikertRow[];
  label: string;
  /** Names of 1..5 for tooltips (e.g. "1"..."5" or words). */
  valueLabels: string[];
}) {
  const t = useTranslations("Charts");
  const f = useChartFormat();
  // Half-width scale shared by all rows: the widest side decides it.
  const half = Math.max(
    0.5,
    ...rows.map((r) => {
      const mid = share(r.counts, 2, 3) / 2;
      return Math.max(lowShare(r.counts) + mid, highShare(r.counts) + mid);
    }),
  );
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-full max-w-4xl flex-col gap-2"
    >
      <div className="grid grid-cols-[minmax(8rem,16rem)_4.5rem_1fr_4.5rem_6.5rem] gap-2 text-xs text-muted-foreground">
        <span />
        <span className="text-right">{t("likert.low")}</span>
        <span className="text-center">{t("likert.center")}</span>
        <span>{t("likert.high")}</span>
        <span />
      </div>
      {orderLikert(rows).map((r) => {
        const n = r.counts.reduce((a, b) => a + b, 0);
        const mid = share(r.counts, 2, 3);
        const leftW = lowShare(r.counts) + mid / 2;
        return (
          <div
            key={r.key}
            data-testid={r.testId ?? "likert-row"}
            className="grid grid-cols-[minmax(8rem,16rem)_4.5rem_1fr_4.5rem_6.5rem] items-center gap-2"
          >
            <span
              className={`line-clamp-2 text-sm leading-tight ${r.strong ? "font-semibold" : ""}`}
              title={r.label}
            >
              {r.label}
            </span>
            <span
              className="text-right text-xs font-medium tabular-nums"
              data-testid="likert-low"
            >
              {f.share(lowShare(r.counts))}
            </span>
            <div className="relative h-7">
              <span
                aria-hidden="true"
                className="absolute inset-y-[-4px] left-1/2 w-px bg-foreground/40"
              />
              <div
                className="absolute inset-y-0 flex gap-0.5"
                style={{
                  left: `${50 - (leftW / half) * 50}%`,
                  width: `${(n ? 1 / half : 0) * 50}%`,
                }}
              >
                {r.counts.map((c, i) => {
                  if (!c) return null;
                  const s = c / n;
                  const tip = t("likert.tip", {
                    row: r.label,
                    value: valueLabels[i],
                    count: c,
                    share: f.share(s),
                  });
                  return (
                    <span
                      key={i}
                      data-value={i + 1}
                      data-tip={tip}
                      aria-label={tip}
                      role="img"
                      tabIndex={0}
                      style={{ width: `${s * 100}%` }}
                      className={`flex min-w-0 items-center justify-center rounded-[2px] text-xs tabular-nums outline-offset-1 focus-visible:outline-2 focus-visible:outline-ring ${FILL[i]}`}
                    >
                      {s >= 0.12 ? f.share(s) : null}
                    </span>
                  );
                })}
              </div>
            </div>
            <span
              className="text-xs font-medium tabular-nums"
              data-testid="likert-high"
            >
              {f.share(highShare(r.counts))}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t("nShort", { n })}
              {r.mean != null ? ` · x̄ ${f.decimal(r.mean)}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
