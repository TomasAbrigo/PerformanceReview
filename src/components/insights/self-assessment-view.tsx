import { CardCollection } from "@/components/card-collection";
import { ProgressBar } from "@/components/progress-bar";
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
            <CardCollection
              gridClassName="record-grid"
              role="group"
              aria-label={t("gapTable")}
            >
              {report.gap.map((g) => (
                <article key={g.questionRevisionId} className="record-card">
                  <header>
                    <h3 className="text-lg">{g.prompt[locale]}</h3>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("answers")}: {g.n}
                    </p>
                  </header>
                  {(
                    [
                      ["self", g.meanSelf],
                      ["manager", g.meanManager],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <p className="mb-2 flex justify-between text-sm">
                        <span>{t(key)}</span>
                        <span>{fmt(value)}</span>
                      </p>
                      <ProgressBar percent={value * 100} label={t(key)} />
                    </div>
                  ))}
                  <p className="insight-callout">
                    {t("gap")}:{" "}
                    <span className="font-heading text-2xl tabular-nums">
                      {fmt(g.meanGap)}
                    </span>
                  </p>
                </article>
              ))}
            </CardCollection>
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
