import { CardCollection } from "@/components/card-collection";
import {
  MessagesSquare,
  ThumbsUp,
  Lightbulb,
  Scale,
  ThumbsDown,
  Minus,
} from "lucide-react";
import { IconTile } from "@/components/experience";
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
import { ChartFrame } from "@/components/charts";
import { MiniBar, SentimentBars } from "./sentiment-bars";

/** Order of the KPI tiles: total first, then People's order of the dashboard. */
const KPI_ORDER = [
  "total",
  "positive",
  "constructive",
  "mixed",
  "negative",
  "neutral",
] as const satisfies readonly ("total" | Sentiment)[];

/** Total and per-sentiment counts of what the filters select. */
export function Kpis({ counts }: { counts: SentimentCounts | null }) {
  const t = useTranslations("Qualitative.kpis");
  if (!counts) return null;
  return (
    <ul
      aria-label={t("title")}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
    >
      {KPI_ORDER.map((k) => {
        const Icon = {
          total: MessagesSquare,
          positive: ThumbsUp,
          constructive: Lightbulb,
          mixed: Scale,
          negative: ThumbsDown,
          neutral: Minus,
        }[k];
        return (
          <li
            key={k}
            className={`flex flex-col gap-3 rounded-xl border border-border p-4 ${k === "total" ? "bg-brand-900 text-white" : "bg-card"}`}
          >
            <IconTile
              className={
                k === "total" ? "bg-white/10 text-brand-200" : undefined
              }
            >
              <Icon className="size-5" />
            </IconTile>
            <span className="text-xs">{t(k)}</span>
            <span className="stat-value">{counts[k]}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** n of a chart: comments behind every bar. */
const totalOf = (rows: SentimentCounts[]) =>
  rows.reduce((n, r) => n + r.total, 0);

export function ByDimension({
  rows,
  dimensionLabel,
}: {
  rows: DimensionSentiment[];
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
      empty={rows.length === 0 ? t("empty") : null}
    >
      <SentimentBars
        sorted
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
}: {
  rows: GroupSentiment[];
  children?: React.ReactNode;
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
      empty={rows.length === 0 ? tq("empty") : null}
    >
      <SentimentBars
        sorted
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

export function Trend({ points }: { points: TrendPoint[] }) {
  const t = useTranslations("Qualitative");
  const tc = useTranslations("Charts");
  return (
    <ChartFrame
      id="sentiment-trend"
      title={t("trend.title")}
      howToRead={t("trend.how")}
      meta={tc("metaN", { n: totalOf(points) })}
      empty={points.length === 0 ? t("empty") : null}
    >
      <SentimentBars
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

export function Themes({ themes }: { themes: ThemeRank[] }) {
  const t = useTranslations("Qualitative.themes");
  const tq = useTranslations("Qualitative");
  return (
    <section className="flex flex-col gap-2">
      <h2>{t("title")}</h2>
      {themes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tq("empty")}</p>
      ) : (
        <>
          <ol aria-label={t("title")} className="flex flex-col gap-2">
            {themes.map((th) => (
              <li
                key={th.theme}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{th.theme}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {t("count", { n: th.count })}
                  </span>
                </div>
                <MiniBar
                  counts={th.sentiment}
                  label={t("sentiment", { theme: th.theme })}
                />
                {th.quotes.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
                    {th.quotes.map((q, i) => (
                      <li key={i}>
                        <q>{q}</q>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">{t("quotesNote")}</p>
        </>
      )}
    </section>
  );
}

export function Indicators({ rows }: { rows: IndicatorSentiment[] }) {
  const t = useTranslations("Qualitative.indicators");
  const ts = useTranslations("Qualitative.sentiment");
  const locale = useLocale() as "es" | "en";
  const role = (r: string) =>
    t.has(r as "retention") ? t(r as "retention") : r;
  return (
    <section className="flex flex-col gap-2">
      <h2>{t("title")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <CardCollection
          role="group"
          aria-label={t("title")}
          gridClassName="record-grid"
        >
          {rows.map((r) => (
            <article key={`${r.role}-${r.option}`} className="record-card">
              <header>
                <h3 className="text-lg">{role(r.role)}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("answer")}: {r.label?.[locale] ?? r.option}
                </p>
              </header>
              <MiniBar
                counts={r}
                label={`${role(r.role)} · ${r.label?.[locale] ?? r.option}`}
              />
              <dl className="record-facts">
                {sentiments.map((key) => (
                  <div key={key}>
                    <dt>{ts(key)}</dt>
                    <dd>
                      <span className="stat-value-sm">{r[key]}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </CardCollection>
      )}
    </section>
  );
}
