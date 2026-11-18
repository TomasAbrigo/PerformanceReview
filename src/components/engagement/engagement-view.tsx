import { useFormatter, useTranslations } from "next-intl";
import { Empty, Panel } from "@/components/insights/parts";
import type {
  EngagementEvolution,
  EngagementMonth,
} from "@/modules/analytics/engagement/types";
import { engagementSegments } from "@/modules/engagement/kinds";
import { SEGMENT_FILL, SEGMENT_SWATCH } from "./segments";

const W = 560;
const H = 220;
const PAD = { l: 36, r: 16, t: 12, b: 34 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

/** x of the i-th of n months, spread over the width. */
const xOf = (i: number, n: number) =>
  PAD.l + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
/** y of a 0-100 value: 100 at the top. */
const yOf = (value: number) => PAD.t + ((100 - value) / 100) * plotH;

/** `M x y L x y ...`: one stroke per run of months with a value, a hidden month is a gap. */
function runs(values: (number | null)[]) {
  const parts: string[] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const joined = i > 0 && values[i - 1] !== null;
    parts.push(`${joined ? "L" : "M"}${xOf(i, values.length)},${yOf(v)}`);
  });
  return parts.join(" ");
}

/** Month label: "mar 26" (the month is a first of month, read as UTC). */
function useMonthLabel() {
  const format = useFormatter();
  return (month: string) =>
    format.dateTime(new Date(`${month}T00:00:00Z`), {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
}

/**
 * The monthly engagement of the people in view: a line chart with the mean
 * score and the participation (both in percent), the segments of each month as
 * stacked bars, and the table with every number (the text twin of both).
 * A month direction cannot see (under the minimum) leaves a gap in the lines
 * and an empty bar.
 */
export function EngagementView({ data }: { data: EngagementEvolution }) {
  const t = useTranslations("Engagement");
  const format = useFormatter();
  const label = useMonthLabel();
  if (!data.months.length) return <Empty />;
  const n = data.months.length;
  const score = data.months.map((m) =>
    m.mean === null ? null : Math.round(m.mean * 100),
  );
  const participation = data.months.map((m) =>
    m.participation === null ? null : Math.round(m.participation * 100),
  );
  const percent = (v: number | null) =>
    v === null ? t("hidden") : format.number(v / 100, { style: "percent" });
  const lines = [
    {
      key: "score" as const,
      values: score,
      className: "stroke-chart-seq fill-chart-seq",
      dash: undefined,
    },
    {
      key: "participation" as const,
      values: participation,
      className: "stroke-chart-sent-mixed fill-chart-sent-mixed",
      dash: "6 4",
    },
  ];
  const lineText = lines
    .map(
      ({ key, values }) =>
        `${t(`line.${key}`)}: ${data.months
          .map((m, i) =>
            t("line.point", {
              month: label(m.month),
              value: percent(values[i]),
            }),
          )
          .join(", ")}`,
    )
    .join(". ");
  const barW = Math.min(36, (plotW / n) * 0.7);
  const cell = (
    m: EngagementMonth,
    segment: (typeof engagementSegments)[number],
  ) => (m.segments ? m.segments[segment] : null);
  const barText = (m: EngagementMonth) =>
    m.hidden
      ? t("segments.hiddenMonth", { month: label(m.month) })
      : m.segments
        ? `${label(m.month)}: ${engagementSegments
            .map((s) => `${t(`segment.${s}`)} ${m.segments![s]}`)
            .join(", ")}`
        : t("segments.hiddenCells", { month: label(m.month) });
  return (
    <div className="flex flex-col gap-4" data-testid="engagement-view">
      <Panel id="engagement-line" title={t("line.title")} hint={t("line.hint")}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-w-2xl"
          role="img"
          aria-label={`${t("line.chartLabel")}. ${lineText}`}
        >
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={yOf(g)}
                y2={yOf(g)}
                className="stroke-border"
              />
              <text
                x={PAD.l - 6}
                y={yOf(g) + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {g}
              </text>
            </g>
          ))}
          {lines.map(({ key, values, className, dash }) => (
            <g key={key} className={className} data-series={key}>
              <path
                d={runs(values)}
                fill="none"
                strokeWidth={2}
                strokeDasharray={dash}
              />
              {values.map((v, i) =>
                v === null ? null : (
                  <circle
                    key={data.months[i].month}
                    cx={xOf(i, n)}
                    cy={yOf(v)}
                    r={3.5}
                    strokeWidth={0}
                  >
                    <title>
                      {`${t(`line.${key}`)} · ${t("line.point", {
                        month: label(data.months[i].month),
                        value: percent(v),
                      })}`}
                    </title>
                  </circle>
                ),
              )}
            </g>
          ))}
          {data.months.map((m, i) => (
            <text
              key={m.month}
              x={xOf(i, n)}
              y={H - 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {label(m.month)}
            </text>
          ))}
        </svg>
        <ul className="flex flex-wrap gap-4 text-sm">
          <li className="flex items-center gap-2">
            <span className="h-0.5 w-6 bg-chart-seq" aria-hidden="true" />
            {t("line.score")}
          </li>
          <li className="flex items-center gap-2">
            <span
              className="h-0 w-6 border-t-2 border-dashed border-chart-sent-mixed"
              aria-hidden="true"
            />
            {t("line.participation")}
          </li>
        </ul>
      </Panel>

      <Panel
        id="engagement-segments"
        title={t("segments.title")}
        hint={t("segments.hint")}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-w-2xl"
          role="img"
          aria-label={`${t("segments.chartLabel")}. ${data.months
            .map(barText)
            .join(". ")}`}
        >
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={yOf(g)}
                y2={yOf(g)}
                className="stroke-border"
              />
              <text
                x={PAD.l - 6}
                y={yOf(g) + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {g}%
              </text>
            </g>
          ))}
          {data.months.map((m, i) => {
            const total = m.people ?? 0;
            let acc = 0;
            return (
              <g key={m.month} data-month={m.month}>
                <title>{barText(m)}</title>
                {m.segments && total > 0
                  ? engagementSegments.map((s) => {
                      const share = (m.segments![s] / total) * 100;
                      const top = yOf(acc + share);
                      const height = yOf(acc) - top;
                      acc += share;
                      return height > 0 ? (
                        <rect
                          key={s}
                          x={xOf(i, n) - barW / 2}
                          y={top}
                          width={barW}
                          height={height}
                          className={SEGMENT_FILL[s]}
                          data-segment={s}
                        />
                      ) : null;
                    })
                  : null}
                <text
                  x={xOf(i, n)}
                  y={H - 12}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {label(m.month)}
                </text>
              </g>
            );
          })}
        </svg>
        <ul className="flex flex-wrap gap-4 text-sm">
          {engagementSegments.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`size-3 rounded-sm ${SEGMENT_SWATCH[s]}`}
                aria-hidden="true"
              />
              {t(`segment.${s}`)}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel id="engagement-table" title={t("table.title")}>
        <div className="overflow-x-auto">
          <table className="text-sm" aria-label={t("table.title")}>
            <thead>
              <tr>
                {[
                  t("table.month"),
                  t("table.people"),
                  t("table.respondents"),
                  t("table.participation"),
                  t("table.mean"),
                  ...engagementSegments.map((s) => t(`segment.${s}`)),
                ].map((h) => (
                  <th key={h} className="p-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} className="border-t" data-month={m.month}>
                  <td className="p-1">{label(m.month)}</td>
                  {m.hidden ? (
                    <td
                      className="p-1 text-muted-foreground"
                      colSpan={4 + engagementSegments.length}
                    >
                      {t("table.under", { min: data.minGroupSize ?? 0 })}
                    </td>
                  ) : (
                    <>
                      <td className="p-1 tabular-nums">{m.people}</td>
                      <td className="p-1 tabular-nums">
                        {m.respondents ?? t("hidden")}
                      </td>
                      <td className="p-1 tabular-nums">
                        {m.participation === null
                          ? t("hidden")
                          : format.number(m.participation, {
                              style: "percent",
                            })}
                      </td>
                      <td className="p-1 tabular-nums">
                        {m.mean === null
                          ? t("hidden")
                          : format.number(m.mean, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                      </td>
                      {engagementSegments.map((s) => (
                        <td key={s} className="p-1 tabular-nums">
                          {cell(m, s) ?? t("hidden")}
                        </td>
                      ))}
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.hiddenMonths > 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {t("table.hiddenMonths", {
              count: data.hiddenMonths,
              min: data.minGroupSize ?? 0,
            })}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
