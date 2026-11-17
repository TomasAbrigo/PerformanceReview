import { useLocale, useTranslations } from "next-intl";
import type {
  DimensionSentiment,
  IndicatorSentiment,
  ThemeRank,
  TrendPoint,
} from "@/modules/qualitative-analysis/types";
import { SentimentBars } from "./sentiment-bars";

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
      <h2 className="text-lg font-semibold">{t("byDimension.title")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <SentimentBars
          label={t("byDimension.chart")}
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

export function Trend({ points }: { points: TrendPoint[] }) {
  const t = useTranslations("Qualitative");
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{t("trend.title")}</h2>
      {points.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <SentimentBars
          label={t("trend.chart")}
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
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      {themes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tq("empty")}</p>
      ) : (
        <>
          <ol aria-label={t("title")} className="flex flex-col gap-2">
            {themes.map((th) => (
              <li key={th.theme} className="rounded-md border p-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{th.theme}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {t("count", { n: th.count })}
                  </span>
                </div>
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
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <table aria-label={t("title")} className="text-sm">
          <thead>
            <tr className="text-left">
              <th className="pr-4">{t("indicator")}</th>
              <th className="pr-4">{t("answer")}</th>
              <th className="pr-4">{ts("positive")}</th>
              <th className="pr-4">{ts("constructive")}</th>
              <th className="pr-4">{ts("negative")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.role}-${r.option}`}>
                <td className="pr-4">{role(r.role)}</td>
                <td className="pr-4">{r.label?.[locale] ?? r.option}</td>
                <td className="pr-4 tabular-nums">{r.positive}</td>
                <td className="pr-4 tabular-nums">{r.constructive}</td>
                <td className="pr-4 tabular-nums">{r.negative}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
