import { ClipboardCheck, MessageSquareWarning, UserCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ChartFrame, useChartFormat } from "@/components/charts";
import type { DrillBase } from "@/components/drill/drill-link";
import { MetricCard, ScaleBar } from "@/components/experience";
import { SentimentBars } from "@/components/qualitative/sentiment-bars";
import {
  type CommentDrills,
  commentDrill,
  Themes,
} from "@/components/qualitative/views";
import type { CompletionGroup } from "@/modules/analytics/completion";
import { sentiments } from "@/modules/qualitative-analysis/constants";
import type { SelfAssessmentReport } from "@/modules/insights/self-assessment";
import { type KpiThresholds, percentTone } from "@/modules/insights/tone";
import { pct, type Side, sideOf } from "./completion-table";

const isSentiment = (v: string) =>
  (sentiments as readonly string[]).includes(v);

/**
 * The self-assessment report: the KPIs (completion of each side and the
 * negative share of the self comments, on their scale, toned, each opens its
 * records), completion per group as compact bars, what the self reviews say
 * (sentiment and themes, every mark opens its comments) and how they compare
 * with the manager's (the rating gap, or the sentiment of each side).
 */
export function SelfAssessmentView({
  report,
  dimensionLabel,
  groupBy = "department",
  base,
  cycleId,
  thresholds,
}: {
  report: SelfAssessmentReport;
  groupBy?: "department" | "manager";
  /** dimension key -> label (resolved by the page). */
  dimensionLabel: Record<string, string>;
  /** Where the drills open (absent: no drill-down). */
  base?: DrillBase;
  cycleId?: string;
  thresholds?: KpiThresholds;
}) {
  const t = useTranslations("Insights.SelfAssessment");
  const ti = useTranslations("Insights");
  const tc = useTranslations("Insights.completion");
  const f = useChartFormat();
  const locale = useLocale() as "es" | "en";
  const dim = (d: string) => dimensionLabel[d] ?? d;
  const drills = (side: "self" | "manager"): CommentDrills | undefined =>
    base && cycleId ? { base, scope: { cycle: cycleId, side } } : undefined;
  const selfDrills = drills("self");
  const total = report.completion.total;
  const selfComments = report.sentiment.reduce((n, r) => n + r.total, 0);
  const selfNegative = report.sentiment.reduce((n, r) => n + r.negative, 0);
  const negShare = selfComments ? selfNegative / selfComments : 0;
  const completionCard = (side: Side) => {
    if (!total) return null;
    const v = sideOf(total, side);
    const p = pct(v);
    const pending = v.total - v.submitted;
    return (
      <MetricCard
        key={side}
        label={tc(side)}
        value={f.percent(p)}
        icon={
          side === "self" ? (
            <UserCheck className="size-5" />
          ) : (
            <ClipboardCheck className="size-5" />
          )
        }
        status={thresholds ? percentTone(p, thresholds) : undefined}
        note={t("kpi.submitted", { submitted: v.submitted, total: v.total })}
        scale={{
          value: p,
          min: 0,
          max: 100,
          label: tc("meter", {
            label: tc(side),
            submitted: v.submitted,
            total: v.total,
          }),
          minLabel: "0 %",
          maxLabel: "100 %",
        }}
        drill={
          base && pending > 0
            ? {
                base,
                drill: { kind: "completion", side, state: "pending" },
                label: t("kpi.openPending", { n: pending, side: tc(side) }),
              }
            : undefined
        }
      />
    );
  };
  const gapRows = report.sentimentGap.flatMap((g) =>
    (["self", "manager"] as const).flatMap((side) => {
      const c = g[side];
      return c
        ? [
            {
              ...c,
              key: `${g.dimension}:${side}`,
              label: t(side === "self" ? "rowSelf" : "rowManager", {
                dimension: dim(g.dimension),
              }),
            },
          ]
        : [];
    }),
  );
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">
        {report.minGroupSize === null
          ? ti("fullHint")
          : ti("maskedHint", { min: report.minGroupSize })}
      </p>
      <section
        aria-label={t("kpi.title")}
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      >
        {completionCard("self")}
        {completionCard("manager")}
        <MetricCard
          label={t("kpi.negative")}
          value={f.share(negShare)}
          icon={<MessageSquareWarning className="size-5" />}
          status={
            thresholds && selfComments
              ? percentTone(negShare * 100, thresholds, "down")
              : undefined
          }
          note={t("kpi.negativeNote", { n: selfNegative, total: selfComments })}
          scale={{
            value: negShare * 100,
            min: 0,
            max: 100,
            label: t("kpi.negativeScale", { share: f.share(negShare) }),
            minLabel: "0 %",
            maxLabel: "100 %",
          }}
          drill={
            selfDrills && selfNegative > 0
              ? {
                  ...commentDrill(selfDrills, { sentiment: "negative" }),
                  label: t("kpi.openNegative", { n: selfNegative }),
                }
              : undefined
          }
        />
      </section>
      <CompletionBars
        groups={report.completion.groups}
        others={report.completion.others}
        groupBy={groupBy}
        suppressed={
          report.completion.minGroupSize !== null
            ? report.completion.suppressed
            : 0
        }
      />
      <ChartFrame
        id="self-sentiment"
        title={t("sentimentTitle")}
        howToRead={t("sentimentHow")}
        kind="sentiment"
        empty={report.sentiment.length === 0 ? ti("empty") : null}
      >
        <SentimentBars
          sorted
          label={t("sentimentChart")}
          rows={report.sentiment.map((r) => ({
            ...r,
            key: r.dimension,
            label: dim(r.dimension),
          }))}
          drillOf={
            selfDrills
              ? (dimension, sentiment) =>
                  isSentiment(sentiment)
                    ? commentDrill(selfDrills, {
                        dimension,
                        sentiment: sentiment as "positive",
                      })
                    : undefined
              : undefined
          }
        />
      </ChartFrame>
      <Themes themes={report.themes} total={selfComments} drills={selfDrills} />
      {report.gap.length > 0 ? (
        <ChartFrame
          id="self-gap"
          title={t("gapTitle")}
          howToRead={t("gapHint")}
          kind="distribution"
        >
          <ul aria-label={t("gapTable")} className="flex flex-col gap-3">
            {report.gap.map((g) => (
              <li
                key={g.questionRevisionId}
                className="grid items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(10rem,18rem)_1fr_6rem]"
              >
                <span className="text-sm leading-tight">
                  {g.prompt[locale]}
                  <small className="block text-xs text-muted-foreground">
                    {t("answers")}: {g.n}
                  </small>
                </span>
                <div className="flex flex-col gap-1">
                  {(
                    [
                      ["self", g.meanSelf],
                      ["manager", g.meanManager],
                    ] as const
                  ).map(([key, value]) => (
                    <ScaleBar
                      key={key}
                      value={value}
                      min={0}
                      max={1}
                      label={`${t(key)}: ${f.decimal(value)}`}
                      minLabel={t(key)}
                      maxLabel={f.decimal(value)}
                    />
                  ))}
                </div>
                <span
                  className="tone-pill justify-self-start tabular-nums"
                  data-tone={
                    Math.abs(g.meanGap) >= 0.2
                      ? "risk"
                      : Math.abs(g.meanGap) >= 0.1
                        ? "watch"
                        : "good"
                  }
                >
                  {t("gap")} {g.meanGap > 0 ? "+" : ""}
                  {f.decimal(g.meanGap)}
                </span>
              </li>
            ))}
          </ul>
        </ChartFrame>
      ) : null}
      {gapRows.length > 0 ? (
        <ChartFrame
          id="self-vs-manager-sentiment"
          title={t("sentimentGapTitle")}
          howToRead={t("sentimentGapHint")}
          kind="comments"
          tone={report.gap.length === 0 ? "highlight" : "default"}
        >
          <SentimentBars
            label={t("sentimentGapChart")}
            rows={gapRows}
            drillOf={
              base && cycleId
                ? (key, sentiment) => {
                    const at = key.lastIndexOf(":");
                    const side = key.slice(at + 1) as "self" | "manager";
                    const d = drills(side);
                    return d && isSentiment(sentiment)
                      ? commentDrill(d, {
                          dimension: key.slice(0, at),
                          sentiment: sentiment as "positive",
                        })
                      : undefined;
                  }
                : undefined
            }
          />
        </ChartFrame>
      ) : null}
    </div>
  );
}

/** Completion per group as two thin bars per row (self, manager). */
function CompletionBars({
  groups,
  others,
  groupBy,
  suppressed,
}: {
  groups: CompletionGroup[];
  others: CompletionGroup | null;
  groupBy: "department" | "manager";
  suppressed: number;
}) {
  const t = useTranslations("Insights.completion");
  const ti = useTranslations("Insights");
  const ts = useTranslations("Insights.SelfAssessment");
  const teams = groups.filter((g) => g.key !== null && g.label === null);
  const rows = [
    ...groups.map((g) => ({
      g,
      name:
        g.key !== null && g.label === null
          ? t("team", { n: teams.indexOf(g) + 1 })
          : (g.label ??
            t(groupBy === "manager" ? "noManager" : "noDepartment")),
    })),
    ...(others ? [{ g: others, name: ti("others") }] : []),
  ].sort((a, b) => pct(sideOf(a.g, "self")) - pct(sideOf(b.g, "self")));
  return (
    <ChartFrame
      id="self-completion"
      title={ti("completion.title")}
      howToRead={ts("completionHow")}
      kind="completion"
      empty={rows.length === 0 ? ti("empty") : null}
    >
      <ul aria-label={t("table")} className="flex flex-col gap-2">
        {rows.map(({ g, name }) => (
          <li
            key={`${g.key ?? "none"}-${name}`}
            className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(8rem,16rem)_1fr_1fr]"
          >
            <span className="text-sm leading-tight">
              {name}
              <small className="ml-1 text-xs text-muted-foreground">
                · {t("n")}: {g.participants}
              </small>
            </span>
            {(["self", "manager"] as const).map((side) => {
              const v = sideOf(g, side);
              return (
                <ScaleBar
                  key={side}
                  value={pct(v)}
                  min={0}
                  max={100}
                  label={t("meter", {
                    label: `${name} · ${t(side)}`,
                    submitted: v.submitted,
                    total: v.total,
                  })}
                  minLabel={t(side)}
                  maxLabel={`${pct(v)} % · ${v.submitted}/${v.total}`}
                />
              );
            })}
          </li>
        ))}
      </ul>
      {suppressed > 0 ? (
        <p className="text-xs text-muted-foreground">
          {ti("suppressed", { n: suppressed })}
        </p>
      ) : null}
    </ChartFrame>
  );
}
