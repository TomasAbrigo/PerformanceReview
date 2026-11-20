import { shownDelta } from "@/modules/insights/delta";
import { useFormatter, useTranslations } from "next-intl";
import { MetricCard, ScaleBar } from "@/components/experience";
import { Panel } from "@/components/insights/parts";
import {
  highShare,
  LIKERT_SWATCH,
  lowShare,
  PanelIcon,
  StackedBar100,
  useChartFormat,
} from "@/components/charts";
import { type DrillBase, DrillLink } from "@/components/drill/drill-link";
import { SEGMENT_SWATCH } from "@/components/engagement/segments";
import { RiskMatrixView } from "@/components/indicators/risk-matrix-view";
import { engagementSegments } from "@/modules/engagement/kinds";
import { SignalsPanel, SubstancePanel } from "@/components/qualitative/reading";
import { useThemeLabel } from "@/components/qualitative/theme-label";
import { Link } from "@/i18n/navigation";
import type { Indicator } from "@/modules/analytics/indicators/types";
import {
  executiveModes,
  type ExecutiveMode,
  type ExecutiveReport,
  type IndicatorSummary,
} from "@/modules/insights/executive";
import {
  atRiskTone,
  kpiThresholds,
  likertTarget,
  likertTone,
  percentTarget,
  percentTone,
} from "@/modules/insights/tone";
import {
  DEFAULT_SETTINGS,
  type Settings,
} from "@/modules/settings/definitions";
import { pct, sideOf } from "./completion-table";

/** "Cualitativo | Cuantitativo | Ambos": links, the mode lives in the URL. */
export function ModeToggle({
  mode,
  cycleId,
  filters = {},
}: {
  mode: ExecutiveMode;
  cycleId: string;
  /** The org cuts (account, project, DM, Santex Lead) that ride along. */
  filters?: Record<string, string | undefined>;
}) {
  const t = useTranslations("Insights.Executive");
  const hrefFor = (m: ExecutiveMode) => {
    const q = new URLSearchParams({ cycle: cycleId, mode: m });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    return `/insights/executive?${q.toString()}`;
  };
  return (
    <nav aria-label={t("mode")} className="segmented">
      {executiveModes.map((m) => (
        <Link
          key={m}
          href={hrefFor(m)}
          aria-current={m === mode ? "true" : undefined}
        >
          {t(`modes.${m}`)}
        </Link>
      ))}
    </nav>
  );
}

/** The settings the view reads its tones from (thresholds of /settings/insights). */
export type ExecutiveSettings = Pick<
  Settings,
  | "alerts.riskThreshold"
  | "targets.goodPct"
  | "targets.watchPct"
  | "engagement.cutoffAlto"
  | "engagement.cutoffMedio"
>;

const LIKERT_INK = [
  "text-white",
  "text-foreground",
  "text-foreground",
  "text-foreground",
  "text-white",
];

/** No data: hidden under the minimum (direction), or simply empty (People). */
function Unavailable({ min }: { min: number | null }) {
  const ti = useTranslations("Insights");
  return (
    <p className="text-sm text-muted-foreground">
      {min === null ? ti("empty") : ti("hidden", { min })}
    </p>
  );
}

/**
 * Retention and engagement answers 1-5 as two 100 % bars (low red to high
 * teal), each segment opening the people who got that value.
 */
function IndicatorBars({
  report,
  base,
}: {
  report: ExecutiveReport;
  base: DrillBase;
}) {
  const t = useTranslations("Insights.Executive");
  const tc = useTranslations("Charts");
  const f = useChartFormat();
  const which = (["retention", "engagement"] as const).filter(
    (k) => report[k] !== undefined,
  );
  const values = ["1", "2", "3", "4", "5"];
  return (
    <div className="flex flex-col gap-3">
      <StackedBar100
        label={t("distributionTitle")}
        series={values.map((v, i) => ({
          key: v,
          label: v,
          fill: LIKERT_SWATCH[i],
          ink: LIKERT_INK[i],
        }))}
        rows={which.map((k) => {
          const d = report[k];
          return {
            key: k,
            label: t(k),
            testId: `exec-${k}-bar`,
            masked: d
              ? undefined
              : report.minGroupSize === null
                ? tc("noData")
                : t("hiddenShort", { min: report.minGroupSize }),
            values: Object.fromEntries(
              values.map((v, i) => [v, d?.counts[i] ?? 0]),
            ),
          };
        })}
        drillOf={(row, value) => ({
          base,
          drill: {
            kind: "indicator",
            indicator: row as Indicator,
            value: Number(value),
          },
        })}
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {which.map((k) => {
          const d = report[k];
          return d && d.n ? (
            <li key={k} className="tabular-nums">
              {t(k)}: {tc("likert.low")} {f.share(lowShare(d.counts))} ·{" "}
              {tc("likert.high")} {f.share(highShare(d.counts))}
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}

/** The KPI of an indicator: its mean on the 1-5 scale, toned by the risk threshold. */
function IndicatorCard({
  which,
  data,
  previous,
  min,
  base,
  riskThreshold,
}: {
  which: Indicator;
  data: IndicatorSummary;
  previous: IndicatorSummary | undefined;
  min: number | null;
  base: DrillBase;
  riskThreshold: number;
}) {
  const t = useTranslations("Insights.Executive");
  const f = useChartFormat();
  const mean = data?.mean ?? null;
  // #133: the one rule of a delta (rounded to the decimal shown, flat when it
  // rounds to 0,0, none over fewer people than the minimum).
  const delta = shownDelta({
    now: mean,
    before: previous?.mean,
    decimals: 1,
    n: [data?.n, previous?.n],
    minN: min,
  });
  const tx = useTranslations("Experience");
  return (
    <MetricCard
      testId={`exec-${which}`}
      label={t(which)}
      icon={
        <PanelIcon kind={which === "retention" ? "people" : "engagement"} />
      }
      value={mean === null ? "—" : f.decimal(mean)}
      status={mean === null ? undefined : likertTone(mean, riskThreshold)}
      scale={
        mean === null
          ? undefined
          : {
              value: mean,
              min: 1,
              max: 5,
              label: t("scaleOf", {
                label: t(which),
                value: f.decimal(mean),
                max: 5,
              }),
              target: {
                value: likertTarget(riskThreshold),
                text: String(likertTarget(riskThreshold)),
              },
            }
      }
      delta={
        delta === null
          ? undefined
          : {
              value: delta,
              text: t("vsPrevious", {
                delta: `${delta > 0 ? "+" : ""}${f.decimal(delta)}`,
              }),
              basis: tx("deltaBasis", {
                now: data?.n ?? 0,
                before: previous?.n ?? 0,
              }),
            }
      }
      drill={
        data
          ? {
              base,
              drill: { kind: "indicator", indicator: which, value: null },
              label: t("drill.indicator", { label: t(which), n: data.n }),
            }
          : undefined
      }
      note={data ? t("n", { n: data.n }) : undefined}
    >
      {data ? null : <Unavailable min={min} />}
    </MetricCard>
  );
}

/** The executive view's KPIs and panels; which ones show depends on the mode. */
export function ExecutiveReportView({
  report,
  previous = null,
  dimensionLabel,
  base = { pathname: "/insights/executive", query: {} },
  settings = DEFAULT_SETTINGS,
}: {
  report: ExecutiveReport;
  /** The same report of the cycle before, for the deltas (none: no deltas). */
  previous?: ExecutiveReport | null;
  dimensionLabel: Record<string, string>;
  /** The page the drills ride on (path and search params). */
  base?: DrillBase;
  settings?: ExecutiveSettings;
}) {
  const t = useTranslations("Insights.Executive");
  const ti = useTranslations("Insights");
  const tEngagement = useTranslations("Engagement.tile");
  const format = useFormatter();
  const themeLabel = useThemeLabel();
  const min = report.minGroupSize;
  const total = report.completion.total;
  const prevTotal = previous?.completion.total ?? null;
  const targets = kpiThresholds(settings);
  const riskThreshold = settings["alerts.riskThreshold"];
  // #133: on the unrounded percents, to one decimal (as /insights/completion).
  const pointsDelta = (now: number, before: number | null | undefined) => {
    const value = shownDelta({ now, before, decimals: 1 });
    return value === null
      ? undefined
      : {
          value,
          text: t("vsPreviousPoints", {
            delta: format.number(value, {
              maximumFractionDigits: 1,
              signDisplay: "exceptZero",
            }),
          }),
        };
  };
  const exact = (v: { submitted: number; total: number }) =>
    v.total ? (v.submitted / v.total) * 100 : 0;
  const goals = report.goals;
  const risk = report.risk;
  const riskShare =
    risk && risk.riskCount !== null && risk.total
      ? (risk.riskCount / risk.total) * 100
      : null;
  const maxTheme = Math.max(1, ...(report.themes ?? []).map((th) => th.count));
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {min === null ? ti("fullHint") : ti("maskedHint", { min })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div
          className="grid gap-4 sm:col-span-2 sm:grid-cols-2"
          data-testid="exec-completion"
        >
          {total ? (
            (["self", "manager"] as const).map((side) => {
              const v = sideOf(total, side);
              const p = pct(v);
              const before = prevTotal ? exact(sideOf(prevTotal, side)) : null;
              const label = t(side === "self" ? "selfPct" : "managerPct");
              const pending = v.total - v.submitted;
              return (
                <MetricCard
                  key={side}
                  label={label}
                  icon={<PanelIcon kind="completion" />}
                  value={
                    <span data-testid={`exec-${side}-pct`}>
                      {ti("percent", { value: p })}
                    </span>
                  }
                  status={v.total ? percentTone(p, targets) : undefined}
                  scale={{
                    value: p,
                    min: 0,
                    max: 100,
                    label: ti("completion.meter", {
                      label,
                      submitted: v.submitted,
                      total: v.total,
                    }),
                    minLabel: "0 %",
                    maxLabel: "100 %",
                    target: {
                      value: percentTarget(targets),
                      text: ti("percent", { value: percentTarget(targets) }),
                    },
                  }}
                  delta={pointsDelta(exact(v), before)}
                  drill={{
                    base,
                    drill: { kind: "completion", side, state: "submitted" },
                    label: t("drill.submitted", { label, n: v.submitted }),
                  }}
                  note={
                    <>
                      {t("ofParticipants", {
                        submitted: v.submitted,
                        total: v.total,
                        participants: total.participants,
                      })}
                      {pending > 0 ? (
                        <>
                          {" · "}
                          <DrillLink
                            base={base}
                            drill={{
                              kind: "completion",
                              side,
                              state: "pending",
                            }}
                            label={t("drill.pending", { n: pending })}
                            className="underline"
                          >
                            {t("pending", { n: pending })}
                          </DrillLink>
                        </>
                      ) : null}
                    </>
                  }
                />
              );
            })
          ) : (
            <MetricCard
              label={t("completionTitle")}
              icon={<PanelIcon kind="completion" />}
              value="—"
            >
              <Unavailable min={min} />
            </MetricCard>
          )}
        </div>
        {report.retention !== undefined ? (
          <IndicatorCard
            which="retention"
            data={report.retention}
            previous={previous?.retention}
            min={min}
            base={base}
            riskThreshold={riskThreshold}
          />
        ) : null}
        {report.engagement !== undefined ? (
          <IndicatorCard
            which="engagement"
            data={report.engagement}
            previous={previous?.engagement}
            min={min}
            base={base}
            riskThreshold={riskThreshold}
          />
        ) : null}
        {goals !== undefined ? (
          <MetricCard
            testId="exec-goals"
            label={t("goalsCompleted")}
            icon={<PanelIcon kind="goals" />}
            // The completion shown against the target counts the goals that
            // were due by the reference date: one not due yet is not a failure.
            value={
              goals?.completedDuePct == null
                ? "—"
                : ti("percent", { value: Math.round(goals.completedDuePct) })
            }
            status={
              goals?.completedDuePct == null
                ? undefined
                : percentTone(goals.completedDuePct, targets)
            }
            scale={
              goals?.completedDuePct == null
                ? undefined
                : {
                    value: goals.completedDuePct,
                    min: 0,
                    max: 100,
                    label: `${t("goalsCompleted")}: ${ti("percent", { value: Math.round(goals.completedDuePct) })}`,
                    minLabel: "0 %",
                    maxLabel: "100 %",
                    target: {
                      value: percentTarget(targets),
                      text: ti("percent", { value: percentTarget(targets) }),
                    },
                  }
            }
            note={
              goals?.completedDuePct == null
                ? undefined
                : t("goalsDueNote", {
                    done: goals.completedDue,
                    due: goals.due,
                    date: format.dateTime(new Date(`${goals.asOf}T00:00:00Z`), {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    }),
                  })
            }
            delta={
              goals?.completedDuePct == null
                ? undefined
                : pointsDelta(
                    goals.completedDuePct,
                    previous?.goals?.completedDuePct,
                  )
            }
            drill={
              goals && goals.completed > 0
                ? {
                    base,
                    drill: { kind: "goals", state: "completed" },
                    label: t("drill.goals", { n: goals.peopleWithGoals }),
                  }
                : undefined
            }
          >
            {goals ? (
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between gap-4">
                  <dt>{t("goalsCount")}</dt>
                  <dd className="tabular-nums">
                    {goals.goals > 0 ? (
                      <DrillLink
                        base={base}
                        drill={{ kind: "goals", state: "all" }}
                        label={t("drill.goals", { n: goals.peopleWithGoals })}
                        className="underline"
                      >
                        {goals.goals}
                      </DrillLink>
                    ) : (
                      goals.goals
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>{t("goalsOverdue")}</dt>
                  <dd className="tabular-nums">
                    {goals.overduePct === null ? (
                      "—"
                    ) : goals.overdue > 0 ? (
                      <DrillLink
                        base={base}
                        drill={{ kind: "goals", state: "overdue" }}
                        label={t("drill.overdue", { n: goals.overdue })}
                        className="underline"
                      >
                        {ti("percent", { value: Math.round(goals.overduePct) })}
                      </DrillLink>
                    ) : (
                      ti("percent", { value: Math.round(goals.overduePct) })
                    )}
                  </dd>
                </div>
              </dl>
            ) : (
              <Unavailable min={min} />
            )}
          </MetricCard>
        ) : null}
        {risk ? (
          <MetricCard
            testId="exec-risk-kpi"
            label={t("risk")}
            icon={<PanelIcon kind="matrix" />}
            value={risk.riskCount === null ? "—" : risk.riskCount}
            status={
              risk.riskCount === null || risk.total === null
                ? undefined
                : atRiskTone(risk.riskCount, risk.total, targets)
            }
            scale={
              riskShare === null || risk.total === null
                ? undefined
                : {
                    value: risk.riskCount ?? 0,
                    min: 0,
                    max: risk.total,
                    label: t("riskCount", { n: risk.riskCount ?? 0 }),
                  }
            }
            drill={
              risk.riskCount
                ? {
                    base,
                    drill: {
                      kind: "risk",
                      retention: "low",
                      engagement: "low",
                    },
                    label: t("riskCount", { n: risk.riskCount }),
                  }
                : undefined
            }
            note={
              risk.riskCount === null
                ? undefined
                : risk.total !== null
                  ? `${t("riskCount", { n: risk.riskCount })} ${t("riskOf", { total: risk.total })}`
                  : t("riskCount", { n: risk.riskCount })
            }
          >
            {risk.riskCount === null ? <Unavailable min={min} /> : null}
          </MetricCard>
        ) : null}
      </div>
      {report.retention !== undefined ? (
        <Panel
          id="exec-indicators"
          kind="distribution"
          title={t("distributionTitle")}
          hint={t("distributionHint")}
        >
          <IndicatorBars report={report} base={base} />
        </Panel>
      ) : null}
      {risk || report.engagementMonthly !== undefined ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {risk ? (
            <Panel
              id="exec-risk"
              kind="matrix"
              tone="highlight"
              title={t("risk")}
              hint={t("riskHint")}
            >
              {risk.riskCount === null &&
              risk.total === null &&
              !risk.suppressed ? (
                <Unavailable min={min} />
              ) : (
                <RiskMatrixView matrix={risk} drill={base} />
              )}
            </Panel>
          ) : null}
          {report.engagementMonthly !== undefined ? (
            <div
              data-testid="exec-engagement-monthly"
              className="flex flex-col [&>section]:flex-1"
            >
              <Panel
                id="exec-engagement-panel"
                kind="engagement"
                title={tEngagement("title")}
              >
                {report.engagementMonthly ? (
                  <EngagementMonthlyTile
                    data={report.engagementMonthly}
                    min={min}
                    settings={settings}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {tEngagement("outsideCycle")}
                  </p>
                )}
              </Panel>
            </div>
          ) : null}
        </div>
      ) : null}
      {report.substance ? (
        report.substance.length === 0 && min !== null ? (
          <Unavailable min={min} />
        ) : (
          <SubstancePanel
            rows={report.substance}
            dimensionLabel={dimensionLabel}
            drills={
              min === null
                ? { base, scope: { cycle: report.cycleId } }
                : undefined
            }
          />
        )
      ) : null}
      {report.signals !== undefined ? (
        <SignalsPanel
          s={report.signals}
          byGroup={[]}
          vsIndicators={[]}
          groupScope={() => null}
          drills={
            min === null
              ? { base, scope: { cycle: report.cycleId } }
              : undefined
          }
        />
      ) : null}
      {report.themes ? (
        <div className="grid gap-4">
          {report.themes ? (
            <Panel
              id="exec-themes"
              kind="themes"
              title={t("themes")}
              hint={t("themesHint")}
            >
              {report.themes.length === 0 ? (
                <Unavailable min={min} />
              ) : (
                <ol aria-label={t("themes")} className="flex flex-col gap-1">
                  {report.themes.map((th) => {
                    const label = themeLabel(th.theme);
                    return (
                      <li key={th.theme}>
                        <DrillLink
                          base={base}
                          drill={{ kind: "theme", theme: th.theme }}
                          label={t("drill.theme", {
                            theme: label,
                            n: th.count,
                          })}
                          className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3 px-1 py-1.5 text-sm hover:bg-brand-fog"
                        >
                          <span className="truncate">{label}</span>
                          <span className="h-2.5 rounded-sm bg-brand-200/50">
                            <span
                              className="block h-full rounded-sm bg-chart-seq"
                              style={{
                                width: `${(th.count / maxTheme) * 100}%`,
                              }}
                            />
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {t("themeCount", { n: th.count })}
                          </span>
                        </DrillLink>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Panel>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The latest month of the monthly engagement: mean score on 0-1, participation and segments. */
function EngagementMonthlyTile({
  data,
  min,
  settings,
}: {
  data: NonNullable<ExecutiveReport["engagementMonthly"]>;
  min: number | null;
  settings: ExecutiveSettings;
}) {
  const t = useTranslations("Engagement.tile");
  const ts = useTranslations("Engagement.segment");
  const format = useFormatter();
  const { latest, previous } = data;
  const label = format.dateTime(new Date(`${latest.month}T00:00:00Z`), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const delta =
    latest.mean !== null && previous?.mean != null
      ? Math.round((latest.mean - previous.mean) * 100)
      : null;
  // The same figure as the Engagement view: a percentage of the 0-1 score.
  const mean =
    latest.mean === null
      ? null
      : format.number(Math.round(latest.mean * 100) / 100, {
          style: "percent",
        });
  const tone =
    latest.mean === null
      ? undefined
      : percentTone(latest.mean * 100, {
          goodPct: settings["engagement.cutoffAlto"],
          watchPct: settings["engagement.cutoffMedio"],
        });
  const segTotal = latest.segments
    ? engagementSegments.reduce((n, s) => n + latest.segments![s], 0)
    : 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {data.period
            ? t("monthInCycle", { month: label })
            : t("month", { month: label })}
        </p>
        {latest.hidden ? (
          <p className="text-sm text-muted-foreground">
            {t("hidden", { min: min ?? 0 })}
          </p>
        ) : (
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-2">
              <dt>{t("mean")}</dt>
              <dd className="flex flex-wrap items-baseline gap-3">
                <span className="stat-value">{mean ?? "—"}</span>
                {tone ? (
                  <span className="tone-pill" data-tone={tone}>
                    {/* The same words as the KPI cards. */}
                    <ToneWord tone={tone} />
                  </span>
                ) : null}
                {delta !== null ? (
                  <span className="delta-pill">
                    {t("vsPrevious", {
                      delta: delta > 0 ? `+${delta}` : delta,
                    })}
                  </span>
                ) : null}
              </dd>
              {latest.mean !== null ? (
                <dd>
                  <ScaleBar
                    value={Math.round(latest.mean * 100)}
                    min={0}
                    max={100}
                    minLabel="0 %"
                    maxLabel="100 %"
                    tone={tone}
                    label={`${t("mean")}: ${mean}`}
                  />
                </dd>
              ) : null}
            </div>
            <div className="flex gap-4">
              <dt>{t("participation")}</dt>
              <dd className="tabular-nums">
                {latest.participation === null
                  ? "—"
                  : format.number(latest.participation, { style: "percent" })}
              </dd>
            </div>
          </dl>
        )}
        <Link href="/insights/engagement" className="text-sm underline">
          {t("link")}
        </Link>
      </div>
      {latest.segments ? (
        <ul
          aria-label={t("segments")}
          className="flex flex-col gap-1.5 text-sm"
        >
          {engagementSegments.map((s) => (
            <li
              key={s}
              className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2"
            >
              <span className="flex items-center gap-2">
                <span
                  className={`size-2.5 rounded-sm ${SEGMENT_SWATCH[s]}`}
                  aria-hidden="true"
                />
                {ts(s)}
              </span>
              <span
                className="h-2 rounded-sm bg-brand-200/40"
                aria-hidden="true"
              >
                <span
                  className={`block h-full rounded-sm ${SEGMENT_SWATCH[s]}`}
                  style={{
                    width: `${segTotal ? (latest.segments![s] / segTotal) * 100 : 0}%`,
                  }}
                />
              </span>
              <span className="text-right tabular-nums">
                {latest.segments![s]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ToneWord({ tone }: { tone: "good" | "watch" | "risk" }) {
  const t = useTranslations("Experience");
  return <>{t(`tone.${tone}`)}</>;
}
