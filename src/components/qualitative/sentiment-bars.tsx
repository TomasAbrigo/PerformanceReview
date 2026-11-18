import { useTranslations } from "next-intl";
import {
  ChartLegend,
  ChartTableToggle,
  SENTIMENT_COLORS,
  StackedBar100,
  orderRows,
  useChartFormat,
  type StackSeries,
} from "@/components/charts";
import {
  sentiments,
  type Sentiment,
} from "@/modules/qualitative-analysis/constants";
import type { SentimentCounts } from "@/modules/qualitative-analysis/types";

export type StackedRow = SentimentCounts & { key: string; label: string };

/** The series of the sentiment stack, in the fixed order of the palette. */
export function useSentimentSeries(): StackSeries[] {
  const t = useTranslations("Qualitative");
  return sentiments.map((s) => ({
    key: s,
    label: t(`sentiment.${s}`),
    ...SENTIMENT_COLORS[s],
  }));
}

/** What orders the rows: the share of negative and mixed comments. */
export const RISK_SENTIMENTS: Sentiment[] = ["negative", "mixed"];

/**
 * 100% stacked horizontal bars of the five sentiments (kit StackedBar100):
 * the legend in stack order, a percent inside each wide segment, n per row,
 * a tooltip per segment and the table twin. `sorted` orders the rows by
 * their negative + mixed share and names the worst one (the takeaway);
 * otherwise rows keep their order (cycles stay chronological).
 */
export function SentimentBars({
  rows,
  label,
  firstColumn,
  sorted = false,
}: {
  rows: StackedRow[];
  label: string;
  firstColumn?: string;
  sorted?: boolean;
}) {
  const t = useTranslations("Qualitative");
  const f = useChartFormat();
  const series = useSentimentSeries();
  const stackRows = rows.map((r) => ({
    key: r.key,
    label: r.label,
    testId: "sentiment-bar",
    title: t("byDimension.bar", {
      label: r.label,
      positive: r.positive,
      constructive: r.constructive,
      neutral: r.neutral,
      mixed: r.mixed,
      negative: r.negative,
    }),
    values: Object.fromEntries(sentiments.map((s) => [s, r[s]])),
  }));
  const worst = sorted
    ? orderRows(stackRows, series, RISK_SENTIMENTS).find((r) =>
        RISK_SENTIMENTS.some((s) => r.values[s] > 0),
      )
    : undefined;
  const worstShare = (r: { values: Record<string, number> }) => {
    const n = sentiments.reduce((a, s) => a + r.values[s], 0);
    return n ? (r.values.negative + r.values.mixed) / n : 0;
  };
  return (
    <div className="flex flex-col gap-3">
      {worst && rows.length > 1 ? (
        <p className="text-sm font-medium" data-testid="chart-takeaway">
          {t("takeaway.worst", {
            label: worst.label,
            share: f.share(worstShare(worst)),
          })}
        </p>
      ) : null}
      <Legend />
      <StackedBar100
        rows={stackRows}
        series={series}
        sortBy={sorted ? RISK_SENTIMENTS : undefined}
        label={label}
      />
      <ChartTableToggle
        caption={label}
        table={{
          head: [
            firstColumn ?? t("byDimension.label"),
            ...sentiments.map((s) => t(`sentiment.${s}`)),
            t("kpis.total"),
          ],
          rows: rows.map((r) => [
            r.label,
            ...sentiments.map((s) => r[s]),
            r.total,
          ]),
        }}
      />
    </div>
  );
}

/** The five sentiments with their colors, in the order of the bars. */
export function Legend() {
  const t = useTranslations("Qualitative");
  const series = useSentimentSeries();
  return (
    <ChartLegend
      label={t("legend")}
      items={series.map((s) => ({
        key: s.key,
        label: s.label,
        swatch: s.fill,
      }))}
    />
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
  const series = useSentimentSeries();
  return (
    <div data-testid="theme-sentiment" className="w-full max-w-xs">
      <StackedBar100
        compact
        label={label}
        series={series}
        rows={[
          {
            key: "theme",
            label,
            values: Object.fromEntries(sentiments.map((s) => [s, counts[s]])),
          },
        ]}
      />
    </div>
  );
}
