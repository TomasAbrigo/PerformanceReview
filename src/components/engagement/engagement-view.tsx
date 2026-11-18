import { useFormatter, useTranslations } from "next-intl";
import { Empty, Panel } from "@/components/insights/parts";
import type {
  EngagementEvolution,
  EngagementMonth,
} from "@/modules/analytics/engagement/types";
import { engagementSegments } from "@/modules/engagement/kinds";
import {
  ChartLegend,
  LineTrend,
  StackedBar100,
  useChartFormat,
} from "@/components/charts";
import { SEGMENT_COLORS } from "./segments";

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
  const tc = useTranslations("Charts");
  const format = useFormatter();
  const label = useMonthLabel();
  const f = useChartFormat();
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
  const people = data.months.at(-1)?.people;
  const meta = [
    `${label(data.months[0].month)} – ${label(data.months[n - 1].month)}`,
    people != null ? t("line.lastPeople", { n: people }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
      <Panel
        id="engagement-line"
        title={t("line.title")}
        hint={t("line.hint")}
        meta={meta}
      >
        <ChartLegend
          items={[
            {
              key: "score",
              label: t("line.score"),
              swatch: "border-chart-seq",
              line: true,
            },
            {
              key: "participation",
              label: t("line.participation"),
              swatch: "border-chart-sent-mixed",
              line: true,
              dashed: true,
            },
          ]}
        />
        <LineTrend
          testId="engagement-line-chart"
          x={data.months.map((m) => label(m.month))}
          series={lines.map((l) => ({
            key: l.key,
            label: t(`line.${l.key}`),
            values: l.values,
            color: l.className,
            dash: l.dash,
          }))}
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          fmt={(v) => f.percent(v)}
          yTitle={t("line.yTitle")}
          hiddenTip={(i) =>
            data.months[i].hidden
              ? t("segments.hiddenMonth", {
                  month: label(data.months[i].month),
                })
              : null
          }
          label={`${t("line.chartLabel")}. ${lineText}`}
        />
      </Panel>

      <Panel
        id="engagement-segments"
        title={t("segments.title")}
        hint={t("segments.hint")}
        meta={meta}
      >
        <ChartLegend
          items={engagementSegments.map((s) => ({
            key: s,
            label: t(`segment.${s}`),
            swatch: SEGMENT_COLORS[s].fill,
          }))}
        />
        <StackedBar100
          label={t("segments.chartLabel")}
          series={engagementSegments.map((s) => ({
            key: s,
            label: t(`segment.${s}`),
            ...SEGMENT_COLORS[s],
          }))}
          rows={data.months.map((m) => ({
            key: m.month,
            label: label(m.month),
            testId: "segment-row",
            title: barText(m),
            masked: m.hidden
              ? t("segments.masked", { min: data.minGroupSize ?? 0 })
              : !m.segments
                ? t("segments.maskedCells", { min: data.minGroupSize ?? 0 })
                : undefined,
            values: m.segments
              ? Object.fromEntries(
                  engagementSegments.map((s) => [s, m.segments![s]]),
                )
              : {},
          }))}
        />
      </Panel>

      <Panel id="engagement-table" title={t("table.title")}>
        <details>
          <summary className="button-outline">{tc("tableView")}</summary>
          <div className="mt-4 overflow-x-auto">
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
        </details>
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
