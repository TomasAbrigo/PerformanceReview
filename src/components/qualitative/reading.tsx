import {
  AlertTriangle,
  FlaskConical,
  Handshake,
  ShieldAlert,
  Telescope,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  ChartLegend,
  ChartTableToggle,
  type MarkDrill,
  StackedBar100,
  type StackSeries,
  useChartFormat,
} from "@/components/charts";
import { DrillLink } from "@/components/drill/drill-link";
import { MetricCard } from "@/components/experience";
import { Panel } from "@/components/insights/parts";
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { CommentScope } from "@/modules/insights/drill-spec";
import {
  type Signal,
  substances,
  type Substance,
} from "@/modules/qualitative-analysis/constants";
import type {
  Agreement,
  BestWork,
  GroupSignals,
  GroupSubstance,
  Provenance,
  Side,
  SignalIndicatorRow,
  SignalSummary,
  SubstanceRow,
  ThemesBySide,
  ToneRow,
  ValuedDistribution,
  ValuedGroupRow,
  ValuedTrendRow,
  YesNoGroupRow,
  YesNoRow,
  YesNoThemes,
  YesNoTrendRow,
} from "@/modules/qualitative-analysis/reading-types";
import { ALERT_KINDS } from "@/modules/qualitative-analysis/yes-no-kind";
import { SentimentBars } from "./sentiment-bars";
import { useThemeLabel } from "./theme-label";
import { type CommentDrills, commentDrill } from "./views";

/**
 * The open-text reading (#129), panel by panel. Every count is people
 * (distinct, each read once per question and side); every bar says what
 * it is a share of and its n; self and manager never share a bar; every
 * mark opens the records behind it (`drills`; none for direction).
 */

const SUBSTANCE_FILL: Record<Substance, { fill: string; ink: string }> = {
  none: { fill: "bg-chart-div-neg-2", ink: "text-foreground" },
  generic: { fill: "bg-brand-200", ink: "text-foreground" },
  specific: { fill: "bg-chart-div-pos", ink: "text-white" },
};

function useSubstanceSeries(): StackSeries[] {
  const t = useTranslations("Qualitative.reading.substance");
  return substances.map((s) => ({ key: s, label: t(s), ...SUBSTANCE_FILL[s] }));
}

const pick = (text: LocalizedText | null | undefined, locale: string) =>
  text ? (locale === "en" ? text.en : text.es) || text.es : null;

// ---- provenance --------------------------------------------------------------

/** Who read the answers: provider, model, last run, % corrected; the demo warning. */
export function ProvenanceNote({ p }: { p: Provenance | null }) {
  const t = useTranslations("Qualitative.reading.provenance");
  const f = useChartFormat();
  const format = useLocale();
  if (!p || p.labels === 0) return null;
  const corrected = p.human / p.labels;
  const when = p.lastRun
    ? new Date(p.lastRun.finishedAt).toLocaleDateString(
        format === "en" ? "en-GB" : "es-AR",
        { day: "numeric", month: "short", year: "numeric" },
      )
    : null;
  return (
    <section
      aria-label={t("label")}
      data-testid="reading-provenance"
      data-demo={p.demo ? "1" : "0"}
      className={`flex flex-wrap items-start gap-3 rounded-md border p-4 text-sm ${p.demo ? "border-status-pending bg-status-pending-bg" : "border-border bg-card"}`}
    >
      {p.demo ? (
        <FlaskConical className="mt-0.5 size-5 shrink-0" aria-hidden />
      ) : null}
      <div className="flex flex-col gap-1">
        {p.demo ? <p className="font-medium">{t("demo")}</p> : null}
        <p>
          {p.providers.length
            ? t("providers", {
                list: p.providers
                  .map((x) =>
                    x.model ? `${x.provider} (${x.model})` : x.provider,
                  )
                  .join(", "),
              })
            : t("noMachine")}
          {when ? ` · ${t("lastRun", { date: when })}` : null}
        </p>
        <p className="text-muted-foreground">
          {t("counts", {
            labels: p.labels,
            corrected: f.share(corrected),
            human: p.human,
            imported: p.imported,
          })}
        </p>
      </div>
    </section>
  );
}

// ---- substance ---------------------------------------------------------------

/** % concrete / generic / with no content, per question and side. */
export function SubstancePanel({
  rows,
  dimensionLabel,
  drills,
}: {
  rows: SubstanceRow[];
  dimensionLabel: Record<string, string>;
  drills?: CommentDrills;
}) {
  const t = useTranslations("Qualitative.reading");
  const series = useSubstanceSeries();
  const ts = useTranslations("Qualitative.side");
  const label = (r: SubstanceRow) =>
    `${dimensionLabel[r.dimension] ?? r.dimension} · ${ts(r.side)}`;
  return (
    <Panel
      id="substance"
      kind="distribution"
      tone="highlight"
      title={t("substanceTitle")}
      hint={t("substanceHint")}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <ChartLegend
            items={series.map((s) => ({
              key: s.key,
              label: s.label,
              swatch: s.fill,
            }))}
          />
          <StackedBar100
            label={t("substanceTitle")}
            series={series}
            rows={rows.map((r) => ({
              key: `${r.dimension}|${r.side}`,
              label: label(r),
              testId: "substance-bar",
              values: {
                none: r.none,
                generic: r.generic,
                specific: r.specific,
              },
            }))}
            drillOf={
              drills
                ? (key, substance) => {
                    const [dimension, side] = key.split("|");
                    return commentDrill(drills, {
                      dimension,
                      side: side as Side,
                      substance: substance as Substance,
                    });
                  }
                : undefined
            }
          />
          <p className="text-xs text-muted-foreground">{t("peopleNote")}</p>
          <ChartTableToggle
            caption={t("substanceTitle")}
            table={{
              head: [t("question"), ...series.map((s) => s.label), t("people")],
              rows: rows.map((r) => [
                label(r),
                r.none,
                r.generic,
                r.specific,
                r.people,
              ]),
            }}
          />
        </>
      )}
    </Panel>
  );
}

/** The quality of the managers' feedback, per group. */
export function ManagerFeedbackPanel({
  rows,
  drills,
  drillScopeOf,
  children,
}: {
  rows: GroupSubstance[];
  drills?: CommentDrills;
  drillScopeOf: (key: string) => CommentScope | null;
  children?: ReactNode;
}) {
  const t = useTranslations("Qualitative.reading");
  const series = useSubstanceSeries();
  return (
    <Panel
      id="manager-feedback"
      kind="distribution"
      title={t("managerFeedbackTitle")}
      hint={t("managerFeedbackHint")}
    >
      {children}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <StackedBar100
          label={t("managerFeedbackTitle")}
          series={series}
          sortBy={["none"]}
          rows={rows.map((r, i) => ({
            key: r.key ?? `unassigned-${i}`,
            label: r.label ?? (r.key ? t("team") : t("unassigned")),
            testId: "manager-feedback-bar",
            values: { none: r.none, generic: r.generic, specific: r.specific },
          }))}
          drillOf={
            drills
              ? (key, substance) => {
                  const scope = drillScopeOf(key);
                  return scope
                    ? commentDrill(drills, {
                        ...scope,
                        side: "manager",
                        substance: substance as Substance,
                      })
                    : undefined;
                }
              : undefined
          }
        />
      )}
    </Panel>
  );
}

// ---- themes ------------------------------------------------------------------

function SideBar({
  n,
  of,
  label,
  fill,
  drill,
}: {
  n: number;
  of: number;
  label: string;
  fill: string;
  drill?: MarkDrill & { label: string };
}) {
  const f = useChartFormat();
  const share = of ? n / of : 0;
  const value = (
    <span className="tabular-nums">
      {f.share(share)} <span className="text-muted-foreground">({n})</span>
    </span>
  );
  return (
    <div className="grid grid-cols-[1fr_5.5rem] items-center gap-2">
      <div
        className="h-3 w-full overflow-hidden rounded-sm bg-muted"
        role="img"
        aria-label={label}
      >
        <div
          className={`h-full ${fill}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      {drill && n > 0 ? (
        <DrillLink
          base={drill.base}
          drill={drill.drill}
          label={drill.label}
          className="text-right text-xs"
        >
          {value}
        </DrillLink>
      ) : (
        <span className="text-right text-xs">{value}</span>
      )}
    </div>
  );
}

/** The most cited themes of a question, self and manager side by side. */
export function ThemesSidePanel({
  id,
  title,
  data,
  drills,
}: {
  id: string;
  title: string;
  data: ThemesBySide;
  drills?: CommentDrills;
}) {
  const t = useTranslations("Qualitative.reading");
  const ts = useTranslations("Qualitative.side");
  const theme = useThemeLabel();
  const sides: Side[] = ["self", "manager"];
  const fill: Record<Side, string> = {
    self: "bg-chart-1",
    manager: "bg-chart-3",
  };
  return (
    <Panel
      id={id}
      kind="themes"
      title={title}
      hint={t("themesHint")}
      meta={t("themesMeta", {
        self: data.people.self,
        manager: data.people.manager,
      })}
    >
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <ChartLegend
            items={sides.map((s) => ({
              key: s,
              label: t("sideOf", { side: ts(s), n: data.people[s] }),
              swatch: fill[s],
            }))}
          />
          <ol className="flex flex-col gap-4" data-testid={`${id}-list`}>
            {data.rows.map((row) => (
              <li key={row.theme} className="flex flex-col gap-1">
                <p className="text-sm font-medium">{theme(row.theme)}</p>
                {sides.map((s) => (
                  <SideBar
                    key={s}
                    n={row[s]}
                    of={data.people[s]}
                    fill={fill[s]}
                    label={t("themeShare", {
                      theme: theme(row.theme),
                      side: ts(s),
                      n: row[s],
                      of: data.people[s],
                    })}
                    drill={
                      drills
                        ? {
                            ...commentDrill(drills, {
                              dimension: data.dimension,
                              side: s,
                              theme: row.theme,
                            }),
                            label: t("openTheme", {
                              theme: theme(row.theme),
                              side: ts(s),
                            }),
                          }
                        : undefined
                    }
                  />
                ))}
                {[...row.quotes.self, ...row.quotes.manager].length ? (
                  <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
                    {sides.flatMap((s) =>
                      row.quotes[s].map((q) => (
                        <li key={`${s}${q}`}>
                          «{q}» <span className="italic">· {ts(s)}</span>
                        </li>
                      )),
                    )}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}

// ---- agreement ---------------------------------------------------------------

/** Person–manager agreement and the blind spots of improvement. */
export function AgreementPanel({
  a,
  dimensionLabel,
  drills,
}: {
  a: Agreement;
  dimensionLabel: Record<string, string>;
  drills?: CommentDrills;
}) {
  const t = useTranslations("Qualitative.reading");
  const f = useChartFormat();
  const theme = useThemeLabel();
  return (
    <Panel
      id="agreement"
      icon={<Handshake className="size-5" />}
      title={t("agreementTitle")}
      hint={t("agreementHint")}
    >
      {a.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {a.rows.map((r) => (
              <MetricCard
                key={r.dimension}
                label={t("agreementOf", {
                  question: dimensionLabel[r.dimension] ?? r.dimension,
                })}
                value={f.share(r.both ? r.shared / r.both : 0)}
                note={t("agreementNote", { shared: r.shared, both: r.both })}
                scale={{
                  value: r.both ? (r.shared / r.both) * 100 : 0,
                  min: 0,
                  max: 100,
                  label: t("agreementOf", {
                    question: dimensionLabel[r.dimension] ?? r.dimension,
                  }),
                }}
                testId={`agreement-${r.dimension}`}
              />
            ))}
            <MetricCard
              label={t("blindTitle")}
              icon={<Telescope className="size-5" />}
              value={f.share(
                a.improvementBoth ? a.blindPeople / a.improvementBoth : 0,
              )}
              note={t("blindNote", {
                n: a.blindPeople,
                of: a.improvementBoth,
              })}
              testId="agreement-blind"
            />
          </div>
          {a.blindSpots.length ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t("blindSpots")}</p>
              <ul className="flex flex-wrap gap-2" data-testid="blind-spots">
                {a.blindSpots.map((b) => {
                  const text = t("blindSpot", {
                    theme: theme(b.theme),
                    n: b.people,
                  });
                  return (
                    <li key={b.theme} className="tone-pill" data-tone="watch">
                      {drills ? (
                        <DrillLink
                          {...commentDrill(drills, {
                            dimension: "improvement",
                            side: "manager",
                            theme: b.theme,
                          })}
                          label={text}
                        >
                          {text}
                        </DrillLink>
                      ) : (
                        text
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

// ---- signals -----------------------------------------------------------------

/** People with each signal, per group and against retention / engagement. */
export function SignalsPanel({
  s,
  byGroup,
  vsIndicators,
  drills,
  groupScope,
  children,
}: {
  s: SignalSummary | null;
  byGroup: GroupSignals[];
  vsIndicators: SignalIndicatorRow[];
  drills?: CommentDrills;
  groupScope: (key: string) => CommentScope | null;
  children?: ReactNode;
}) {
  const t = useTranslations("Qualitative.reading");
  const ti = useTranslations("Indicators");
  const f = useChartFormat();
  const locale = useLocale();
  if (!s) return null;
  const signalDrill = (signal: Signal, extra: CommentScope = {}) =>
    drills
      ? {
          ...commentDrill(drills, { signal, ...extra }),
          label: t("openSignal", { signal: t(`signal.${signal}`) }),
        }
      : undefined;
  return (
    <Panel
      id="signals"
      icon={<AlertTriangle className="size-5" />}
      tone="highlight"
      title={t("signalsTitle")}
      hint={t("signalsHint")}
      meta={t("signalsMeta", { n: s.withAny, of: s.people })}
    >
      {s.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noSignals")}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="signals-list">
          {s.rows.map((r) => (
            <li
              key={r.signal}
              className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-3"
              data-testid="signal-row"
            >
              <span className="text-sm">{t(`signal.${r.signal}`)}</span>
              <div className="flex flex-col gap-1">
                <SideBar
                  n={r.people}
                  of={s.people}
                  fill="bg-chart-div-neg"
                  label={t("signalShare", {
                    signal: t(`signal.${r.signal}`),
                    n: r.people,
                    of: s.people,
                  })}
                  drill={signalDrill(r.signal)}
                />
                <span className="text-xs text-muted-foreground">
                  {t("signalSides", { self: r.self, manager: r.manager })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {children}
      {byGroup.length ? (
        <ChartTableToggle
          caption={t("signalsByGroup")}
          table={{
            head: [
              t("group"),
              t("people"),
              t("withAny"),
              ...s.rows.map((r) => t(`signal.${r.signal}`)),
            ],
            rows: byGroup.map((g) => [
              g.label ?? (g.key ? t("team") : t("unassigned")),
              g.people,
              `${g.withAny} (${f.share(g.people ? g.withAny / g.people : 0)})`,
              ...s.rows.map((r) => g.counts[r.signal]),
            ]),
          }}
        />
      ) : null}
      {byGroup.length ? (
        <StackedBar100
          label={t("signalsByGroup")}
          sortBy={["with"]}
          series={[
            {
              key: "with",
              label: t("withAny"),
              fill: "bg-chart-div-neg",
              ink: "text-white",
            },
            {
              key: "without",
              label: t("withoutSignal"),
              fill: "bg-muted",
              ink: "text-foreground",
            },
          ]}
          rows={byGroup.map((g, i) => ({
            key: g.key ?? `unassigned-${i}`,
            label: g.label ?? (g.key ? t("team") : t("unassigned")),
            testId: "signals-group-bar",
            values: { with: g.withAny, without: g.people - g.withAny },
          }))}
          drillOf={
            drills
              ? (key, series) => {
                  const scope = groupScope(key);
                  return scope && series === "with"
                    ? commentDrill(drills, scope)
                    : undefined;
                }
              : undefined
          }
        />
      ) : null}
      {vsIndicators.length ? (
        <div
          className="flex flex-col gap-2"
          data-testid="signals-vs-indicators"
        >
          <p className="text-sm font-medium">{t("signalsVsIndicator")}</p>
          <p className="text-xs text-muted-foreground">
            {t("signalsVsIndicatorHint")}
          </p>
          {(["retention", "engagement"] as const).map((role) => {
            const rows = vsIndicators.filter((r) => r.role === role);
            if (!rows.length) return null;
            return (
              <div key={role} className="flex flex-col gap-1">
                <p className="text-xs font-medium">{ti(`indicator.${role}`)}</p>
                {rows.map((r) => (
                  <div
                    key={r.value}
                    className="grid grid-cols-[minmax(8rem,16rem)_1fr] items-center gap-3"
                  >
                    <span className="text-xs">
                      {r.value} · {pick(r.label, locale) ?? ""}
                    </span>
                    <SideBar
                      n={r.withSignal}
                      of={r.people}
                      fill="bg-chart-div-neg"
                      label={t("signalIndicatorShare", {
                        n: r.withSignal,
                        of: r.people,
                      })}
                      drill={
                        drills
                          ? {
                              ...commentDrill(drills, { role, value: r.value }),
                              label: t("signalIndicatorShare", {
                                n: r.withSignal,
                                of: r.people,
                              }),
                            }
                          : undefined
                      }
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </Panel>
  );
}

// ---- yes/no ------------------------------------------------------------------

/** Rate of Sí / No per yes/no question, by cycle and group, and the "how". */
export function YesNoPanel({
  rows,
  trend,
  byGroup,
  themes,
  dimensionLabel,
  drillOf,
}: {
  rows: YesNoRow[];
  trend: YesNoTrendRow[];
  byGroup: YesNoGroupRow[];
  themes: YesNoThemes[];
  dimensionLabel: Record<string, string>;
  /** A segment opens the people who answered it. */
  drillOf?: (dimension: string, side: Side, answer: "yes" | "no") => MarkDrill;
}) {
  const t = useTranslations("Qualitative.reading");
  const ts = useTranslations("Qualitative.side");
  const f = useChartFormat();
  const theme = useThemeLabel();
  const series: StackSeries[] = [
    {
      key: "yes",
      label: t("yesNo.yes"),
      fill: "bg-chart-div-pos",
      ink: "text-white",
    },
    {
      key: "no",
      label: t("yesNo.no"),
      fill: "bg-chart-div-neg",
      ink: "text-white",
    },
  ];
  const label = (d: string) => dimensionLabel[d] ?? d;
  const alerts = rows.filter((r) => ALERT_KINDS.includes(r.kind) && r.no > 0);
  return (
    <Panel
      id="yes-no"
      kind="distribution"
      title={t("yesNoTitle")}
      hint={t("yesNoHint")}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          {alerts.length ? (
            <ul className="flex flex-col gap-2" data-testid="yes-no-alerts">
              {alerts.map((r) => (
                <li
                  key={`${r.dimension}${r.side}`}
                  className="flex items-start gap-2 rounded-md border border-status-pending bg-status-pending-bg p-3 text-sm"
                >
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    {t(
                      `yesNo.alert.${r.kind as "security" | "conversations"}`,
                      {
                        n: r.no,
                        of: r.people,
                        share: f.share(r.people ? r.no / r.people : 0),
                      },
                    )}
                    {drillOf ? (
                      <>
                        {" "}
                        <DrillLink
                          {...drillOf(r.dimension, r.side, "no")}
                          label={t("yesNo.openNo", { n: r.no })}
                        >
                          {t("yesNo.openNo", { n: r.no })}
                        </DrillLink>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <ChartLegend
            items={series.map((s) => ({
              key: s.key,
              label: s.label,
              swatch: s.fill,
            }))}
          />
          <StackedBar100
            label={t("yesNoTitle")}
            series={series}
            rows={rows.map((r) => ({
              key: `${r.dimension}|${r.side}`,
              label: `${label(r.dimension)} · ${ts(r.side)}`,
              testId: "yes-no-bar",
              values: { yes: r.yes, no: r.no },
            }))}
            drillOf={
              drillOf
                ? (key, answer) => {
                    const [dimension, side] = key.split("|");
                    return drillOf(
                      dimension,
                      side as Side,
                      answer as "yes" | "no",
                    );
                  }
                : undefined
            }
          />
          {trend.length ? (
            <ChartTableToggle
              caption={t("yesNoTrend")}
              table={{
                head: [t("question"), t("cycle"), t("yesNo.no"), t("people")],
                rows: trend.map((r) => [
                  label(r.dimension),
                  r.cycleName,
                  `${r.no} (${f.share(r.people ? r.no / r.people : 0)})`,
                  r.people,
                ]),
              }}
            />
          ) : null}
          {byGroup.length ? (
            <ChartTableToggle
              caption={t("yesNoByGroup")}
              table={{
                head: [t("question"), t("group"), t("yesNo.no"), t("people")],
                rows: byGroup.map((r) => [
                  label(r.dimension),
                  r.label ?? (r.key ? t("team") : t("unassigned")),
                  `${r.no} (${f.share(r.people ? r.no / r.people : 0)})`,
                  r.people,
                ]),
              }}
            />
          ) : null}
          {themes.some((x) => x.rows.length) ? (
            <div className="flex flex-col gap-2" data-testid="yes-no-themes">
              <p className="text-sm font-medium">{t("initiatives")}</p>
              {themes
                .filter((x) => x.rows.length)
                .map((x) => (
                  <div key={x.dimension} className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground">
                      {t("initiativesOf", {
                        question: label(x.dimension),
                        n: x.people,
                      })}
                    </p>
                    <ul className="flex flex-wrap gap-2">
                      {x.rows.map((r) => (
                        <li key={r.theme} className="tone-pill">
                          {theme(r.theme)} · {r.people}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

// ---- closed questions --------------------------------------------------------

const VALUED_FILL = [
  { fill: "bg-chart-div-neg", ink: "text-white" },
  { fill: "bg-chart-div-neg-2", ink: "text-foreground" },
  { fill: "bg-chart-div-pos-2", ink: "text-foreground" },
  { fill: "bg-chart-div-pos", ink: "text-white" },
];

function useValuedSeries(d: ValuedDistribution): StackSeries[] {
  const locale = useLocale();
  return [1, 2, 3, 4].map((v, i) => ({
    key: String(v),
    label: `${v} · ${pick(d.labels[i], locale) ?? ""}`,
    ...VALUED_FILL[i],
  }));
}

const valuedValues = (d: ValuedDistribution) =>
  Object.fromEntries(d.counts.map((n, i) => [String(i + 1), n]));

/** "valued" as a 1-4 scale (with the share that does not feel valued) and best work as options. */
export function ClosedQuestionsPanel({
  valued,
  bestWork,
}: {
  valued: {
    total: ValuedDistribution | null;
    byGroup: ValuedGroupRow[];
    trend: ValuedTrendRow[];
  };
  bestWork: BestWork | null;
}) {
  const t = useTranslations("Qualitative.reading");
  const f = useChartFormat();
  const locale = useLocale();
  const total = valued.total;
  const series = useValuedSeries(
    total ?? { counts: [], people: 0, notValued: 0, labels: [] },
  );
  if (!total && !bestWork) return null;
  return (
    <Panel
      id="closed"
      kind="distribution"
      title={t("closedTitle")}
      hint={t("closedHint")}
    >
      {total ? (
        <div className="flex flex-col gap-3" data-testid="valued">
          <MetricCard
            label={t("notValued")}
            value={f.share(total.people ? total.notValued / total.people : 0)}
            note={t("notValuedNote", {
              n: total.notValued,
              of: total.people,
            })}
            scale={{
              value: total.people ? (total.notValued / total.people) * 100 : 0,
              min: 0,
              max: 100,
              label: t("notValued"),
            }}
            testId="not-valued"
          />
          <ChartLegend
            items={series.map((s) => ({
              key: s.key,
              label: s.label,
              swatch: s.fill,
            }))}
          />
          <StackedBar100
            label={t("valuedTitle")}
            series={series}
            sortBy={["1", "2"]}
            rows={[
              {
                key: "total",
                label: t("valuedTotal"),
                values: valuedValues(total),
              },
              ...valued.byGroup.map((g, i) => ({
                key: g.key ?? `unassigned-${i}`,
                label: g.label ?? (g.key ? t("team") : t("unassigned")),
                testId: "valued-group-bar",
                values: valuedValues(g),
              })),
            ]}
          />
          {valued.trend.length > 1 ? (
            <>
              <p className="text-xs font-medium">{t("valuedTrend")}</p>
              <StackedBar100
                label={t("valuedTrend")}
                series={series}
                rows={valued.trend.map((c) => ({
                  key: c.cycleId,
                  label: c.cycleName,
                  values: valuedValues(c),
                }))}
              />
            </>
          ) : null}
        </div>
      ) : null}
      {bestWork ? (
        <div className="flex flex-col gap-2" data-testid="best-work">
          <p className="text-sm font-medium">
            {t("bestWorkTitle", { n: bestWork.people })}
          </p>
          {bestWork.options.map((o) => (
            <div
              key={o.option}
              className="grid grid-cols-[minmax(10rem,20rem)_1fr] items-center gap-3"
            >
              <span className="text-xs">
                {pick(o.label, locale) ?? o.option}
              </span>
              <SideBar
                n={o.people}
                of={bestWork.people}
                fill="bg-chart-2"
                label={t("optionShare", {
                  option: pick(o.label, locale) ?? o.option,
                  n: o.people,
                  of: bestWork.people,
                })}
              />
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

// ---- tone --------------------------------------------------------------------

/** The tone of the free text per question and side: secondary, and conditioned by the question. */
export function TonePanel({
  rows,
  dimensionLabel,
  drills,
}: {
  rows: ToneRow[];
  dimensionLabel: Record<string, string>;
  drills?: CommentDrills;
}) {
  const t = useTranslations("Qualitative.reading");
  const ts = useTranslations("Qualitative.side");
  if (!rows.length) return null;
  return (
    <Panel
      id="tone"
      kind="sentiment"
      title={t("toneTitle")}
      hint={t("toneHint")}
    >
      <SentimentBars
        label={t("toneTitle")}
        firstColumn={t("question")}
        rows={rows.map((r) => ({
          key: `${r.dimension}|${r.side}`,
          label: `${dimensionLabel[r.dimension] ?? r.dimension} · ${ts(r.side)}`,
          positive: r.positive,
          constructive: r.constructive,
          neutral: r.neutral,
          mixed: r.mixed,
          negative: r.negative,
          total: r.people,
        }))}
        drillOf={
          drills
            ? (key, sentiment) => {
                const [dimension, side] = key.split("|");
                return commentDrill(drills, {
                  dimension,
                  side: side as Side,
                  sentiment: sentiment as "positive",
                });
              }
            : undefined
        }
      />
    </Panel>
  );
}

/** Direction under the minimum: the figures are not shown. */
export function MaskedReading({ min }: { min: number | null }) {
  const t = useTranslations("Qualitative.reading");
  return (
    <section
      data-testid="reading-masked"
      className="rounded-md border border-border bg-card p-6 text-sm"
    >
      {t("masked", { min: min ?? 0 })}
    </section>
  );
}
