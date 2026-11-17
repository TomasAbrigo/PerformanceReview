import { useTranslations } from "next-intl";
import { Meter } from "@/components/dashboards/parts";
import { SentimentBars } from "@/components/qualitative/sentiment-bars";
import { Link } from "@/i18n/navigation";
import {
  executiveModes,
  type ExecutiveMode,
  type ExecutiveReport,
  type IndicatorSummary,
} from "@/modules/insights/executive";
import { pct } from "./completion-table";

/** "Cualitativo | Cuantitativo | Ambos": links, the mode lives in the URL. */
export function ModeToggle({
  mode,
  cycleId,
}: {
  mode: ExecutiveMode;
  cycleId: string;
}) {
  const t = useTranslations("Insights.Executive");
  return (
    <nav aria-label={t("mode")} className="inline-flex rounded-md border">
      {executiveModes.map((m) => (
        <Link
          key={m}
          href={`/insights/executive?cycle=${cycleId}&mode=${m}`}
          aria-current={m === mode ? "true" : undefined}
          className={`px-3 py-1 text-sm ${
            m === mode ? "bg-primary text-primary-foreground" : ""
          }`}
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
      className="flex min-w-48 flex-col gap-2 rounded-lg border p-4"
    >
      <h2 className="text-sm text-muted-foreground">{title}</h2>
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
              rx={2}
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
  const ti = useTranslations("Insights");
  return (
    <Tile title={t(which)} testId={`exec-${which}`}>
      {data ? (
        <>
          <div className="text-3xl font-semibold tabular-nums">
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
        <p className="text-sm">{ti("hidden", { min: min ?? 0 })}</p>
      )}
    </Tile>
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
  const min = report.minGroupSize;
  const total = report.completion.total;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {min === null ? ti("fullHint") : ti("maskedHint", { min })}
      </p>
      <div className="flex flex-wrap gap-4">
        <Tile title={t("completionTitle")} testId="exec-completion">
          {total ? (
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="text-sm">{t("participants")}</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {total.n}
                </dd>
              </div>
              {(["self", "manager"] as const).map((side) => (
                <div key={side}>
                  <dt className="text-sm">
                    {t(side === "self" ? "selfPct" : "managerPct")}
                  </dt>
                  <dd className="flex items-center gap-2">
                    <span
                      className="text-2xl font-semibold tabular-nums"
                      data-testid={`exec-${side}-pct`}
                    >
                      {ti("percent", { value: pct(total[side]) })}
                    </span>
                    <Meter
                      width={100}
                      value={
                        total[side].total
                          ? total[side].submitted / total[side].total
                          : 0
                      }
                      label={ti("completion.meter", {
                        label: t(side === "self" ? "selfPct" : "managerPct"),
                        submitted: total[side].submitted,
                        total: total[side].total,
                      })}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm">{ti("hidden", { min: min ?? 0 })}</p>
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
              <p className="text-sm">{ti("hidden", { min: min ?? 0 })}</p>
            ) : (
              <>
                <div className="text-3xl font-semibold tabular-nums">
                  {report.risk.riskCount}
                </div>
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
      </div>
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
            <ol aria-label={t("themes")} className="flex flex-col gap-1">
              {report.themes.map((th) => (
                <li key={th.theme} className="flex justify-between gap-4">
                  <span>{th.theme}</span>
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
  );
}
