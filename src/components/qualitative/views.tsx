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
      className="grid grid-cols-3 gap-2 sm:grid-cols-6"
    >
      {KPI_ORDER.map((k) => (
        <li
          key={k}
          className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
        >
          <span className="text-xs text-muted-foreground">{t(k)}</span>
          <span className="stat-value-sm">{counts[k]}</span>
        </li>
      ))}
    </ul>
  );
}

export function ByDimension({
  rows,
  dimensionLabel,
}: {
  rows: DimensionSentiment[];
  /** dimension key -> label (resolved once by the page). */
  dimensionLabel: Record<string, string>;
}) {
  const t = useTranslations("Qualitative");
  const dim = (d: string) => dimensionLabel[d] ?? d;
  return (
    <section className="flex flex-col gap-2">
      <h2>{t("byDimension.title")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <SentimentBars
          label={t("byDimension.chart")}
          firstColumn={t("byDimension.label")}
          rows={rows.map((r) => ({
            ...r,
            key: r.dimension,
            label: dim(r.dimension),
          }))}
        />
      )}
    </section>
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
  let team = 0;
  return (
    <section className="flex flex-col gap-2" data-testid="sentiment-by-group">
      <h2>{t("title")}</h2>
      {children}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tq("empty")}</p>
      ) : (
        <SentimentBars
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
      )}
    </section>
  );
}

export function Trend({ points }: { points: TrendPoint[] }) {
  const t = useTranslations("Qualitative");
  return (
    <section className="flex flex-col gap-2">
      <h2>{t("trend.title")}</h2>
      {points.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <SentimentBars
          label={t("trend.chart")}
          firstColumn={t("trend.label")}
          rows={points.map((p) => ({
            ...p,
            key: p.cycleId,
            label: p.cycleName,
          }))}
        />
      )}
    </section>
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
        <table aria-label={t("title")} className="text-sm">
          <thead>
            <tr className="text-left">
              <th className="pr-4">{t("indicator")}</th>
              <th className="pr-4">{t("answer")}</th>
              {sentiments.map((s) => (
                <th key={s} className="pr-4">
                  {ts(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.role}-${r.option}`}>
                <td className="pr-4">{role(r.role)}</td>
                <td className="pr-4">{r.label?.[locale] ?? r.option}</td>
                {sentiments.map((s) => (
                  <td key={s} className="pr-4 tabular-nums">
                    {r[s]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
