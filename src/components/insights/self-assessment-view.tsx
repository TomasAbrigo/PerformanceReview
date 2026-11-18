import { useLocale, useTranslations } from "next-intl";
import { SentimentBars } from "@/components/qualitative/sentiment-bars";
import { Themes } from "@/components/qualitative/views";
import type { SelfAssessmentReport } from "@/modules/insights/self-assessment";
import { CompletionTable } from "./completion-table";

const fmt = (n: number) => n.toFixed(2);

/** The self-assessment report: completion, what self reviews say, the gap. */
export function SelfAssessmentView({
  report,
  dimensionLabel,
  groupBy = "department",
}: {
  report: SelfAssessmentReport;
  groupBy?: "department" | "manager";
  /** dimension key -> label (resolved by the page). */
  dimensionLabel: Record<string, string>;
}) {
  const t = useTranslations("Insights.SelfAssessment");
  const ti = useTranslations("Insights");
  const locale = useLocale() as "es" | "en";
  const dim = (d: string) => dimensionLabel[d] ?? d;
  const gapRows = report.sentimentGap.flatMap((g) => [
    ...(g.self
      ? [
          {
            ...g.self,
            key: `${g.dimension}:self`,
            label: t("rowSelf", { dimension: dim(g.dimension) }),
          },
        ]
      : []),
    ...(g.manager
      ? [
          {
            ...g.manager,
            key: `${g.dimension}:manager`,
            label: t("rowManager", { dimension: dim(g.dimension) }),
          },
        ]
      : []),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {report.minGroupSize === null
          ? ti("fullHint")
          : ti("maskedHint", { min: report.minGroupSize })}
      </p>
      <section className="flex flex-col gap-2">
        <h2>{ti("completion.title")}</h2>
        <CompletionTable data={report.completion} groupBy={groupBy} />
      </section>
      <section className="flex flex-col gap-2">
        <h2>{t("sentimentTitle")}</h2>
        {report.sentiment.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ti("empty")}</p>
        ) : (
          <SentimentBars
            label={t("sentimentChart")}
            rows={report.sentiment.map((r) => ({
              ...r,
              key: r.dimension,
              label: dim(r.dimension),
            }))}
          />
        )}
      </section>
      <Themes themes={report.themes} />
      <section className="flex flex-col gap-2">
        <h2>{t("gapTitle")}</h2>
        {report.gap.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ti("empty")}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("gapHint")}</p>
            <table aria-label={t("gapTable")} className="text-sm">
              <thead>
                <tr className="text-left">
                  <th className="pr-4">{t("question")}</th>
                  <th className="pr-4">{t("answers")}</th>
                  <th className="pr-4">{t("self")}</th>
                  <th className="pr-4">{t("manager")}</th>
                  <th className="pr-4">{t("gap")}</th>
                </tr>
              </thead>
              <tbody>
                {report.gap.map((g) => (
                  <tr key={g.questionRevisionId}>
                    <td className="pr-4">{g.prompt[locale]}</td>
                    <td className="pr-4 tabular-nums">{g.n}</td>
                    <td className="pr-4 tabular-nums">{fmt(g.meanSelf)}</td>
                    <td className="pr-4 tabular-nums">{fmt(g.meanManager)}</td>
                    <td className="pr-4 tabular-nums">{fmt(g.meanGap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      {gapRows.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2>{t("sentimentGapTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("sentimentGapHint")}
          </p>
          <SentimentBars label={t("sentimentGapChart")} rows={gapRows} />
        </section>
      ) : null}
    </div>
  );
}
