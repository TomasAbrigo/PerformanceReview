import { useTranslations } from "next-intl";
import { standsOut } from "@/modules/insights/rank";
import {
  ChartLegend,
  ChartTableToggle,
  SENTIMENT_COLORS,
  StackedBar100,
  type MarkDrill,
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
  drillOf,
}: {
  rows: StackedRow[];
  label: string;
  firstColumn?: string;
  sorted?: boolean;
  /** A segment opens its comments: (row key, sentiment) -> drill. */
  drillOf?: (rowKey: string, sentiment: string) => MarkDrill | undefined;
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
  // #133: name the worst only when it stands out from all the rows together
  // beyond the noise of its n.
  const pooled = stackRows.reduce(
    (acc, r) => {
      for (const s of sentiments) acc.n += r.values[s];
      acc.k += r.values.negative + r.values.mixed;
      return acc;
    },
    { k: 0, n: 0 },
  );
  const overall = pooled.n ? pooled.k / pooled.n : 0;
  const named =
    worst &&
    standsOut(
      worst.values.negative + worst.values.mixed,
      sentiments.reduce((a, s) => a + worst.values[s], 0),
      overall,
    );
  return (
    <div className="flex flex-col gap-3">
      {worst && rows.length > 1 ? (
        <p className="text-sm font-medium" data-testid="chart-takeaway">
          {named
            ? t("takeaway.worst", {
                label: worst.label,
                share: f.share(worstShare(worst)),
              })
            : t("takeaway.noStandout", { share: f.share(overall) })}
        </p>
      ) : null}
      <Legend />
      <StackedBar100
        rows={stackRows}
        series={series}
        sortBy={sorted ? RISK_SENTIMENTS : undefined}
        label={label}
        drillOf={drillOf}
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
  drillOf,
}: {
  counts: SentimentCounts;
  label: string;
  /** A segment opens its comments: sentiment -> drill. */
  drillOf?: (sentiment: string) => MarkDrill | undefined;
}) {
  const series = useSentimentSeries();
  return (
    <div data-testid="theme-sentiment" className="w-full">
      <StackedBar100
        compact
        drillOf={drillOf ? (_row, sentiment) => drillOf(sentiment) : undefined}
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
