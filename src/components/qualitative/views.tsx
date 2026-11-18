import {
  MessagesSquare,
  ThumbsUp,
  Lightbulb,
  Scale,
  ThumbsDown,
  Minus,
} from "lucide-react";
import { MetricCard } from "@/components/experience";
import { useLocale, useTranslations } from "next-intl";
import type {
  DimensionSentiment,
  GroupSentiment,
  IndicatorSentiment,
  ThemeRank,
  TrendPoint,
} from "@/modules/qualitative-analysis/types";
import {
  sentiments,
  type Sentiment,
} from "@/modules/qualitative-analysis/constants";
import type { SentimentCounts } from "@/modules/qualitative-analysis/types";
import {
  ChartFrame,
  type MarkDrill,
  useChartFormat,
} from "@/components/charts";
import { type DrillBase, DrillLink } from "@/components/drill/drill-link";
import type { CommentScope } from "@/modules/insights/drill-spec";
import { indicators } from "@/modules/analytics/indicators/types";
import {
  type KpiThresholds,
  percentTone,
  type Tone,
} from "@/modules/insights/tone";
import { MiniBar, SentimentBars } from "./sentiment-bars";
import { useThemeLabel } from "./theme-label";

/**
 * Where the comments behind a mark open: the page (`base`) and the scope of
 * its filters (`scope`); each mark adds what it stands for.
 */
export type CommentDrills = { base: DrillBase; scope: CommentScope };

/** The drill of the comments of `ctx`'s scope narrowed by `extra`. */
export function commentDrill(
  ctx: CommentDrills,
  extra: CommentScope,
): MarkDrill {
  return {
    base: ctx.base,
    drill: { kind: "comments", scope: { ...ctx.scope, ...extra } },
  };
}

const isSentiment = (v: string): v is Sentiment =>
  (sentiments as readonly string[]).includes(v);

/** Order of the KPI tiles after the total: People's order of the dashboard. */
const KPI_ORDER = [
  "positive",
  "constructive",
  "neutral",
  "mixed",
  "negative",
] as const satisfies readonly Sentiment[];

const KPI_ICONS = {
  positive: ThumbsUp,
  constructive: Lightbulb,
  mixed: Scale,
  negative: ThumbsDown,
  neutral: Minus,
} as const;

/** Which way is better for a sentiment's share (none: neutral). */
const BETTER: Record<Sentiment, "up" | "down" | null> = {
  positive: "up",
  constructive: null,
  neutral: null,
  mixed: "down",
  negative: "down",
};

/**
 * The tone of a sentiment's share (0-1): only the shares where less is
 * better (negative, mixed) get one, from People's KPI thresholds mirrored.
 */
export function sentimentShareTone(
  sentiment: Sentiment,
  share: number,
  thresholds: KpiThresholds | undefined,
): Tone | undefined {
  if (!thresholds || BETTER[sentiment] !== "down") return undefined;
  return percentTone(share * 100, thresholds, "down");
}

/**
 * Total and per-sentiment counts of what the filters select: each share on
 * its 0-100 % bar, the tone of the negative and mixed shares, the change in
 * points vs. the previous cycle, and every value opens its comments.
 */
export function Kpis({
  counts,
  previous,
  drills,
  thresholds,
}: {
  counts: SentimentCounts | null;
  /** The cycle before the one selected, for the deltas. */
  previous?: { name: string; counts: SentimentCounts } | null;
  drills?: CommentDrills;
  thresholds?: KpiThresholds;
}) {
  const t = useTranslations("Qualitative.kpis");
  const f = useChartFormat();
  if (!counts) return null;
  const shareOf = (c: SentimentCounts, k: Sentiment) =>
    c.total ? c[k] / c.total : 0;
  return (
    <section
      aria-label={t("title")}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="qualitative-kpis"
    >
      <MetricCard
        featured
        label={t("total")}
        value={f.int(counts.total)}
        icon={<MessagesSquare className="size-5" />}
        note={t("totalNote")}
        drill={
          drills && counts.total > 0
            ? {
                ...commentDrill(drills, {}),
                label: t("openAll", { n: counts.total }),
              }
            : undefined
        }
      />
      {KPI_ORDER.map((k) => {
        const Icon = KPI_ICONS[k];
        const share = shareOf(counts, k);
        const better = BETTER[k];
        const prev =
          previous && previous.counts.total > 0
            ? Math.round((share - shareOf(previous.counts, k)) * 100)
            : null;
        const label = t(k);
        return (
          <MetricCard
            key={k}
            label={label}
            value={f.share(share)}
            icon={<Icon className="size-5" />}
            status={sentimentShareTone(k, share, thresholds)}
            note={t("count", { n: counts[k] })}
            scale={{
              value: share * 100,
              min: 0,
              max: 100,
              label: t("scale", { label, share: f.share(share) }),
              minLabel: "0 %",
              maxLabel: "100 %",
            }}
            delta={
              prev !== null
                ? {
                    value: prev,
                    text: t("delta", {
                      delta: `${prev > 0 ? "+" : ""}${prev}`,
                      cycle: previous!.name,
                    }),
                    ...(better ? { better } : {}),
                  }
                : undefined
            }
            drill={
              drills && counts[k] > 0
                ? {
                    ...commentDrill(drills, { sentiment: k }),
                    label: t("open", { n: counts[k], label }),
                  }
                : undefined
            }
          />
        );
      })}
    </section>
  );
}

/** n of a chart: comments behind every bar. */
const totalOf = (rows: SentimentCounts[]) =>
  rows.reduce((n, r) => n + r.total, 0);

export function ByDimension({
  rows,
  dimensionLabel,
  drills,
}: {
  rows: DimensionSentiment[];
  drills?: CommentDrills;
  /** dimension key -> label (resolved once by the page). */
  dimensionLabel: Record<string, string>;
}) {
  const t = useTranslations("Qualitative");
  const tc = useTranslations("Charts");
  const dim = (d: string) => dimensionLabel[d] ?? d;
  return (
    <ChartFrame
      id="sentiment-by-dimension"
      title={t("byDimension.title")}
      howToRead={t("byDimension.how")}
      meta={tc("metaN", { n: totalOf(rows) })}
      kind="sentiment"
      empty={rows.length === 0 ? t("empty") : null}
    >
      <SentimentBars
        sorted
        drillOf={
          drills
            ? (dimension, sentiment) =>
                isSentiment(sentiment)
                  ? commentDrill(drills, { dimension, sentiment })
                  : undefined
            : undefined
        }
        label={t("byDimension.chart")}
        firstColumn={t("byDimension.label")}
        rows={rows.map((r) => ({
          ...r,
          key: r.dimension,
          label: dim(r.dimension),
        }))}
      />
    </ChartFrame>
  );
}

/**
 * Sentiment of the comments per group of people (area, account, project, DM
 * or Santex Lead), with how many people are behind each. `children` is the
 * toggle of the grouping.
 */
export function ByGroup({
  rows,
  children,
  drillScopeOf,
  drills,
}: {
  rows: GroupSentiment[];
  children?: React.ReactNode;
  /** The scope of a group's key (null: the group cannot be opened). */
  drillScopeOf?: (key: string) => CommentScope | null;
  drills?: CommentDrills;
}) {
  const t = useTranslations("Qualitative.byGroup");
  const tq = useTranslations("Qualitative");
  const tc = useTranslations("Charts");
  let team = 0;
  return (
    <ChartFrame
      id="sentiment-by-group"
      title={t("title")}
      howToRead={t("how")}
      meta={tc("metaN", { n: totalOf(rows) })}
      actions={children}
      kind="people"
      empty={rows.length === 0 ? tq("empty") : null}
    >
      <SentimentBars
        sorted
        drillOf={
          drills && drillScopeOf
            ? (key, sentiment) => {
                const scope = drillScopeOf(key);
                return scope && isSentiment(sentiment)
                  ? commentDrill(drills, { ...scope, sentiment })
                  : undefined;
              }
            : undefined
        }
        label={t("chart")}
        firstColumn={t("label")}
        rows={rows.map((r) => {
          const name =
            r.label ??
            (r.key === null ? t("unassigned") : t("team", { n: ++team }));
          return {
            ...r,
            key: r.key ?? "unassigned",
            label: `${name} · ${t("people", { n: r.participants })}`,
          };
        })}
      />
    </ChartFrame>
  );
}

export function Trend({
  points,
  drills,
}: {
  points: TrendPoint[];
  drills?: CommentDrills;
}) {
  const t = useTranslations("Qualitative");
  const tc = useTranslations("Charts");
  return (
    <ChartFrame
      id="sentiment-trend"
      title={t("trend.title")}
      howToRead={t("trend.how")}
      meta={tc("metaN", { n: totalOf(points) })}
      kind="trend"
      empty={points.length === 0 ? t("empty") : null}
    >
      <SentimentBars
        drillOf={
          drills
            ? (cycle, sentiment) =>
                isSentiment(sentiment)
                  ? commentDrill(drills, { cycle, sentiment })
                  : undefined
            : undefined
        }
        label={t("trend.chart")}
        firstColumn={t("trend.label")}
        rows={points.map((p) => ({
          ...p,
          key: p.cycleId,
          label: p.cycleName,
        }))}
      />
    </ChartFrame>
  );
}

/**
 * The most frequent themes as compact cards: the theme opens its comments,
 * its share of all comments, the sentiment bar (each segment opens those
 * comments) and up to three different example quotes.
 */
export function Themes({
  themes,
  total,
  drills,
}: {
  themes: ThemeRank[];
  /** All comments of the filters (the share's denominator). */
  total?: number;
  drills?: CommentDrills;
}) {
  const t = useTranslations("Qualitative.themes");
  const tq = useTranslations("Qualitative");
  const themeLabel = useThemeLabel();
  const f = useChartFormat();
  return (
    <ChartFrame
      id="themes"
      title={t("title")}
      howToRead={t("how")}
      kind="themes"
      empty={themes.length === 0 ? tq("empty") : null}
    >
      <ol aria-label={t("title")} className="grid gap-3 md:grid-cols-2">
        {themes.map((th) => {
          const name = themeLabel(th.theme);
          const quotes = [...new Set(th.quotes)];
          return (
            <li
              key={th.theme}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
              data-testid="theme-card"
            >
              <div className="flex items-baseline justify-between gap-2">
                {drills ? (
                  <DrillLink
                    {...commentDrill(drills, { theme: th.theme })}
                    label={t("open", { n: th.count, theme: name })}
                    className="font-medium"
                  >
                    {name}
                  </DrillLink>
                ) : (
                  <span className="font-medium">{name}</span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("count", { n: th.count })}
                  {total ? ` · ${f.share(th.count / total)}` : null}
                </span>
              </div>
              <MiniBar
                counts={th.sentiment}
                label={t("sentiment", { theme: name })}
                drillOf={
                  drills
                    ? (sentiment) =>
                        isSentiment(sentiment)
                          ? commentDrill(drills, {
                              theme: th.theme,
                              sentiment,
                            })
                          : undefined
                    : undefined
                }
              />
              {quotes.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {quotes.map((q) => (
                    <li key={q} className="line-clamp-2">
                      <q>{q}</q>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      {themes.some((th) => th.quotes.length > 0) ? (
        <p className="text-xs text-muted-foreground">{t("quotesNote")}</p>
      ) : null}
    </ChartFrame>
  );
}

/**
 * Sentiment of the comments against the manager's answer to retention and
 * engagement: one small multiple per indicator, a 100 % bar per answer (5,
 * the highest, on top), each segment opens those comments.
 */
export function Indicators({
  rows,
  drills,
}: {
  rows: IndicatorSentiment[];
  drills?: CommentDrills;
}) {
  const t = useTranslations("Qualitative.indicators");
  const tc = useTranslations("Charts");
  const locale = useLocale() as "es" | "en";
  const present = indicators.filter((i) => rows.some((r) => r.role === i));
  return (
    <ChartFrame
      id="sentiment-vs-indicators"
      title={t("title")}
      howToRead={t("how")}
      kind="matrix"
      empty={present.length === 0 ? t("empty") : null}
    >
      <div className="flex flex-col gap-6">
        {present.map((role) => {
          const mine = rows
            .filter((r) => r.role === role)
            .sort((a, b) => b.value - a.value);
          return (
            <section
              key={role}
              aria-label={t(role)}
              className="flex flex-col gap-2"
              data-testid={`indicator-${role}`}
            >
              <h3 className="flex items-baseline justify-between gap-2 text-base">
                {t(role)}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tc("metaN", { n: totalOf(mine) })}
                </span>
              </h3>
              <SentimentBars
                label={t("chart", { indicator: t(role) })}
                firstColumn={t("answer")}
                rows={mine.map((r) => ({
                  ...r,
                  key: String(r.value),
                  label: t("row", {
                    value: r.value,
                    answer: r.label?.[locale] ?? r.option,
                  }),
                }))}
                drillOf={
                  drills
                    ? (value, sentiment) =>
                        isSentiment(sentiment)
                          ? commentDrill(drills, {
                              role,
                              value: Number(value),
                              sentiment,
                            })
                          : undefined
                    : undefined
                }
              />
            </section>
          );
        })}
      </div>
    </ChartFrame>
  );
}
