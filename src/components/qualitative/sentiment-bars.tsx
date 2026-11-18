import { useTranslations } from "next-intl";
import {
  sentiments,
  type Sentiment,
} from "@/modules/qualitative-analysis/constants";
import type { SentimentCounts } from "@/modules/qualitative-analysis/types";

/**
 * Sentiment colors, in reading order: green, teal, gray, amber, red (tokens
 * in globals.css, validated for color-vision deficiency). Color is never the
 * only cue: the legend names them in the same order, each segment carries
 * its count, each bar a tooltip, and the chart has a table twin.
 */
const FILL: Record<Sentiment, string> = {
  positive: "fill-chart-sent-positive",
  constructive: "fill-chart-sent-constructive",
  neutral: "fill-chart-sent-neutral",
  mixed: "fill-chart-sent-mixed",
  negative: "fill-chart-sent-negative",
};
const SWATCH: Record<Sentiment, string> = {
  positive: "bg-chart-sent-positive",
  constructive: "bg-chart-sent-constructive",
  neutral: "bg-chart-sent-neutral",
  mixed: "bg-chart-sent-mixed",
  negative: "bg-chart-sent-negative",
};
/** Count text on each fill (dark on the light fills, white on the dark ones). */
const COUNT_TEXT: Record<Sentiment, string> = {
  positive: "fill-white",
  constructive: "fill-[#0f2826]",
  neutral: "fill-[#0f2826]",
  mixed: "fill-white",
  negative: "fill-white",
};

export type StackedRow = SentimentCounts & { key: string; label: string };

const W = 320;
const ROW = 28;
const LABEL_W = 160;

/**
 * 100% stacked horizontal bars of the five sentiments, counts inside each
 * segment and a tooltip per bar. `firstColumn` names the table twin's first
 * column (what each bar is: a dimension, a cycle...).
 */
export function SentimentBars({
  rows,
  label,
  firstColumn,
}: {
  rows: StackedRow[];
  label: string;
  firstColumn?: string;
}) {
  const t = useTranslations("Qualitative");
  return (
    <div className="flex flex-col gap-2">
      <Legend />
      <svg
        role="img"
        aria-label={label}
        width="100%"
        viewBox={`0 0 ${LABEL_W + W + 40} ${rows.length * ROW + 4}`}
        className="max-w-2xl"
      >
        {rows.map((r, i) => {
          let x = LABEL_W;
          const y = i * ROW + 2;
          return (
            <g key={r.key} data-testid="sentiment-bar">
              <title>
                {t("byDimension.bar", {
                  label: r.label,
                  positive: r.positive,
                  constructive: r.constructive,
                  neutral: r.neutral,
                  mixed: r.mixed,
                  negative: r.negative,
                })}
              </title>
              <text
                x={LABEL_W - 8}
                y={y + 16}
                textAnchor="end"
                className="fill-foreground text-[11px]"
              >
                {r.label}
              </text>
              {sentiments.map((s) => {
                const w = r.total ? (r[s] / r.total) * W : 0;
                const seg = (
                  <g key={s}>
                    {w > 0 ? (
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={ROW - 8}
                        className={`${FILL[s]} stroke-background`}
                        strokeWidth={2}
                      />
                    ) : null}
                    {w >= 18 ? (
                      <text
                        x={x + w / 2}
                        y={y + 14}
                        textAnchor="middle"
                        className={`text-[10px] tabular-nums ${COUNT_TEXT[s]}`}
                      >
                        {r[s]}
                      </text>
                    ) : null}
                  </g>
                );
                x += w;
                return seg;
              })}
              <text
                x={LABEL_W + W + 6}
                y={y + 14}
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {r.total}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{firstColumn ?? t("byDimension.label")}</th>
            {sentiments.map((s) => (
              <th key={s} scope="col">
                {t(`sentiment.${s}`)}
              </th>
            ))}
            <th scope="col">{t("kpis.total")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              {sentiments.map((s) => (
                <td key={s}>{r[s]}</td>
              ))}
              <td>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The five sentiments with their colors, in the order of the bars. */
export function Legend() {
  const t = useTranslations("Qualitative");
  return (
    <ul aria-label={t("legend")} className="flex flex-wrap gap-3 text-xs">
      {sentiments.map((s) => (
        <li key={s} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className={`inline-block size-3 rounded-sm border ${SWATCH[s]}`}
          />
          {t(`sentiment.${s}`)}
        </li>
      ))}
    </ul>
  );
}

/** A small stacked bar (no labels) for a row of a list: themes. */
export function MiniBar({
  counts,
  label,
}: {
  counts: SentimentCounts;
  label: string;
}) {
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="theme-sentiment"
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      className="h-2 w-full max-w-xs"
    >
      {
        sentiments.reduce(
          (acc, s) => {
            const w = counts.total ? (counts[s] / counts.total) * 100 : 0;
            if (w > 0) {
              acc.nodes.push(
                <rect
                  key={s}
                  x={acc.x}
                  width={w}
                  height={8}
                  className={`${FILL[s]} stroke-background`}
                  strokeWidth={0.5}
                />,
              );
            }
            acc.x += w;
            return acc;
          },
          { x: 0, nodes: [] as React.ReactNode[] },
        ).nodes
      }
    </svg>
  );
}
