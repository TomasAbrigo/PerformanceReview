import { useFormatter, useTranslations } from "next-intl";
import { Meter } from "@/components/insights/parts";
import { SEGMENT_SWATCH } from "@/components/engagement/segments";
import { engagementSegments } from "@/modules/engagement/kinds";
import { SentimentBars } from "@/components/qualitative/sentiment-bars";
import { Link } from "@/i18n/navigation";
import {
  executiveModes,
  type ExecutiveMode,
  type ExecutiveReport,
  type IndicatorSummary,
} from "@/modules/insights/executive";
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

function Tile({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5"
    >
      <h2 className="kicker text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const BAR_W = 28;
const BAR_H = 60;

/** Counts per value 1-5 as small inline SVG bars. */
function CountBars({ counts, label }: { counts: number[]; label: string }) {
  const max = Math.max(1, ...counts);
  return (
    <svg
      role="img"
      aria-label={label}
      width={counts.length * (BAR_W + 4)}
      height={BAR_H + 16}
    >
      <title>{label}</title>
      {counts.map((c, i) => {
        const h = (c / max) * BAR_H;
        return (
          <g key={i}>
            <rect
              x={i * (BAR_W + 4)}
              y={BAR_H - h}
              width={BAR_W}
              height={h}
              rx={3}
              className="fill-chart-seq"
            >
              <title>{`${i + 1}: ${c}`}</title>
            </rect>
            <text
              x={i * (BAR_W + 4) + BAR_W / 2}
              y={BAR_H + 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function IndicatorTile({
  which,
  data,
  min,
}: {
  which: "retention" | "engagement";
  data: IndicatorSummary;
  min: number | null;
}) {
  const t = useTranslations("Insights.Executive");
  return (
    <Tile title={t(which)} testId={`exec-${which}`}>
      {data ? (
        <>
          <div className="stat-value">
            {data.mean === null ? "—" : data.mean.toFixed(2)}
          </div>
          <div className="text-sm text-muted-foreground">
            {t("n", { n: data.n })}
          </div>
          <CountBars
            counts={data.counts}
            label={t("distribution", { indicator: t(which) })}
          />
        </>
      ) : (
        <Unavailable min={min} />
      )}
    </Tile>
  );
}

/** No data: hidden under the minimum (direction), or simply empty (People). */
function Unavailable({ min }: { min: number | null }) {
  const ti = useTranslations("Insights");
  return (
    <p className="text-sm text-muted-foreground">
      {min === null ? ti("empty") : ti("hidden", { min })}
    </p>
  );
}

/** The latest month of the monthly engagement: mean score, participation and segments. */
function EngagementMonthlyTile({
  data,
  min,
}: {
  data: NonNullable<ExecutiveReport["engagementMonthly"]>;
  min: number | null;
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
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {t("month", { month: label })}
      </p>
      {latest.hidden ? (
        <p className="text-sm text-muted-foreground">
          {t("hidden", { min: min ?? 0 })}
        </p>
      ) : (
        <dl className="flex flex-col gap-1 text-sm">
          <div>
            <dt>{t("mean")}</dt>
            <dd className="stat-value">
              {latest.mean === null
                ? "—"
                : format.number(latest.mean, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
            </dd>
            {delta !== null ? (
              <dd className="text-xs text-muted-foreground tabular-nums">
                {t("vsPrevious", { delta: delta > 0 ? `+${delta}` : delta })}
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
      {latest.segments ? (
        <ul
          aria-label={t("segments")}
          className="flex flex-col gap-0.5 text-sm"
        >
          {engagementSegments.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`size-2.5 rounded-sm ${SEGMENT_SWATCH[s]}`}
                aria-hidden="true"
              />
              <span>{ts(s)}</span>
              <span className="ml-auto tabular-nums">
                {latest.segments![s]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Link href="/insights/engagement" className="text-sm underline">
        {t("link")}
      </Link>
    </>
  );
}

/** The executive view's tiles; which ones show depends on the mode. */
export function ExecutiveReportView({
  report,
  dimensionLabel,
}: {
  report: ExecutiveReport;
  dimensionLabel: Record<string, string>;
}) {
  const t = useTranslations("Insights.Executive");
  const ti = useTranslations("Insights");
  const tEngagement = useTranslations("Engagement.tile");
  const min = report.minGroupSize;
  const total = report.completion.total;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {min === null ? ti("fullHint") : ti("maskedHint", { min })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile title={t("completionTitle")} testId="exec-completion">
          {total ? (
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="text-sm text-muted-foreground">
                  {t("participants")}
                </dt>
                <dd className="stat-value">{total.participants}</dd>
              </div>
              {(["self", "manager"] as const).map((side) => {
                const v = sideOf(total, side);
                return (
                  <div key={side}>
                    <dt className="text-sm text-muted-foreground">
                      {t(side === "self" ? "selfPct" : "managerPct")}
                    </dt>
                    <dd className="flex items-center gap-2">
                      <span
                        className="stat-value-sm"
                        data-testid={`exec-${side}-pct`}
                      >
                        {ti("percent", { value: pct(v) })}
                      </span>
                      <Meter
                        width={100}
                        value={v.total ? v.submitted / v.total : 0}
                        label={ti("completion.meter", {
                          label: t(side === "self" ? "selfPct" : "managerPct"),
                          submitted: v.submitted,
                          total: v.total,
                        })}
                      />
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <Unavailable min={min} />
          )}
        </Tile>
        {report.retention !== undefined ? (
          <IndicatorTile which="retention" data={report.retention} min={min} />
        ) : null}
        {report.engagement !== undefined ? (
          <IndicatorTile
            which="engagement"
            data={report.engagement}
            min={min}
          />
        ) : null}
        {report.risk ? (
          <Tile title={t("risk")} testId="exec-risk">
            {report.risk.riskCount === null ? (
              <Unavailable min={min} />
            ) : (
              <>
                <div className="stat-value">{report.risk.riskCount}</div>
                <p className="text-sm">
                  {t("riskCount", { n: report.risk.riskCount })}
                </p>
                {report.risk.total !== null ? (
                  <p className="text-xs text-muted-foreground">
                    {t("riskOf", { total: report.risk.total })}
                  </p>
                ) : null}
              </>
            )}
          </Tile>
        ) : null}
        {report.engagementMonthly !== undefined ? (
          <Tile title={tEngagement("title")} testId="exec-engagement-monthly">
            {report.engagementMonthly ? (
              <EngagementMonthlyTile
                data={report.engagementMonthly}
                min={min}
              />
            ) : (
              <Unavailable min={min} />
            )}
          </Tile>
        ) : null}
        {report.goals !== undefined ? (
          <Tile title={t("goals")} testId="exec-goals">
            {report.goals ? (
              <dl className="flex flex-col gap-1 text-sm">
                <div>
                  <dt>{t("goalsCompleted")}</dt>
                  <dd className="stat-value">
                    {report.goals.completedPct === null
                      ? "—"
                      : ti("percent", {
                          value: Math.round(report.goals.completedPct),
                        })}
                  </dd>
                </div>
                <div className="flex gap-4">
                  <dt>{t("goalsCount")}</dt>
                  <dd className="tabular-nums">{report.goals.goals}</dd>
                </div>
                <div className="flex gap-4">
                  <dt>{t("goalsOverdue")}</dt>
                  <dd className="tabular-nums">
                    {report.goals.overduePct === null
                      ? "—"
                      : ti("percent", {
                          value: Math.round(report.goals.overduePct),
                        })}
                  </dd>
                </div>
              </dl>
            ) : (
              <Unavailable min={min} />
            )}
          </Tile>
        ) : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        {report.sentiment ? (
          <Tile title={t("sentiment")} testId="exec-sentiment">
            {report.sentiment.length === 0 ? (
              <p className="text-sm text-muted-foreground">{ti("empty")}</p>
            ) : (
              <SentimentBars
                label={t("sentimentChart")}
                rows={report.sentiment.map((r) => ({
                  ...r,
                  key: r.dimension,
                  label: dimensionLabel[r.dimension] ?? r.dimension,
                }))}
              />
            )}
          </Tile>
        ) : null}
        {report.themes ? (
          <Tile title={t("themes")} testId="exec-themes">
            {report.themes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{ti("empty")}</p>
            ) : (
              <ol aria-label={t("themes")} className="flex flex-col gap-2">
                {report.themes.map((th) => (
                  <li key={th.theme} className="flex justify-between gap-4">
                    <span className="text-sm">{th.theme}</span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {t("themeCount", { n: th.count })}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Tile>
        ) : null}
      </div>
    </div>
  );
}
