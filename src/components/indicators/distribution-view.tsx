import { useFormatter, useTranslations } from "next-intl";
import {
  ChartLegend,
  ChartTableToggle,
  DivergingLikert,
  LIKERT_SWATCH,
  lowShare,
  orderLikert,
  useChartFormat,
} from "@/components/charts";
import { Empty } from "@/components/insights/parts";
import type { DrillBase } from "@/components/drill/drill-link";
import type { Drill } from "@/modules/insights/drill-spec";
import {
  INDICATOR_VALUES,
  type IndicatorDistribution,
  type IndicatorSeries,
} from "@/modules/analytics/indicators/types";

/**
 * Distribution of retention or engagement (Likert 1-5) as diverging bars
 * centered on the neutral answer: one row per group (the total first), the
 * groups with the biggest low (1-2) share on top, low and high shares
 * written at both ends, n and mean per row, the group most at risk named
 * as the takeaway, and the table twin. Direction's groups under the minimum
 * are not here (the note says how many people).
 */
/**
 * #117: the page's drill base (segments open the people of that answer in
 * that group; direction's groups are counts, only the total row opens) and
 * the head count under which a group is too small to read as shares.
 */
export type DistributionContext = {
  base: DrillBase;
  masked: boolean;
  smallN: number;
};

export function DistributionView({
  data,
  context,
}: {
  data: IndicatorDistribution;
  context?: DistributionContext;
}) {
  const t = useTranslations("Indicators");
  const format = useFormatter();
  const f = useChartFormat();
  const mean = (value: number) =>
    format.number(value, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  const nameOf = (s: IndicatorSeries) =>
    s.others
      ? t("distribution.others")
      : (s.label ??
        (data.groupBy === "none" ? t("distribution.all") : t("none")));
  const total =
    data.groupBy !== "none" && data.total && data.total.n > 0
      ? data.total
      : null;
  const groups = data.series.filter((s) => s.n > 0);
  const rows = [
    ...(total ? [{ s: total, name: t("distribution.all"), strong: true }] : []),
    ...groups.map((s) => ({ s, name: nameOf(s), strong: false })),
  ];
  const likertRows = rows.map(({ s, name, strong }) => ({
    key: s.others ? "others" : (s.key ?? name),
    label: name,
    counts: s.counts,
    mean: s.mean,
    strong,
    faint: !strong && !!context && s.n < context.smallN,
    testId: "indicator-histogram",
  }));
  const groupBy = data.groupBy;
  const seriesOfKey = new Map(
    rows.map(({ s, name, strong }) => [
      s.others ? "others" : (s.key ?? name),
      { s, strong },
    ]),
  );
  const drillOf = (rowKey: string, value: number) => {
    if (!context) return undefined;
    const row = seriesOfKey.get(rowKey);
    if (!row || row.s.others) return undefined;
    const whole = row.strong || groupBy === "none";
    if (!whole && context.masked) return undefined;
    const drill: Drill = whole
      ? { kind: "indicator", indicator: data.indicator, value }
      : {
          kind: "indicatorGroup",
          indicator: data.indicator,
          value,
          groupBy: groupBy as Exclude<typeof groupBy, "none">,
          key: row.s.key,
        };
    return { base: context.base, drill };
  };
  const faintCount = likertRows.filter((r) => r.faint).length;
  const worst = orderLikert(likertRows.filter((r) => !r.strong))[0];
  const values = INDICATOR_VALUES.map(String);
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? <Empty /> : null}
      {rows.length ? (
        <>
          {worst && groups.length > 1 && lowShare(worst.counts) > 0 ? (
            <p className="text-sm font-medium" data-testid="chart-takeaway">
              {t("distribution.takeaway", {
                group: worst.label,
                share: f.share(lowShare(worst.counts)),
              })}
            </p>
          ) : null}
          <ChartLegend
            items={values.map((v, i) => ({
              key: v,
              label:
                i === 0
                  ? t("distribution.lowest", { value: v })
                  : i === 4
                    ? t("distribution.highest", { value: v })
                    : v,
              swatch: LIKERT_SWATCH[i],
            }))}
          />
          <DivergingLikert
            rows={likertRows}
            label={t("distribution.chart")}
            valueLabels={values.map((v) =>
              t("distribution.value", { value: v }),
            )}
            drillOf={context ? drillOf : undefined}
          />
          {faintCount > 0 && context ? (
            <p className="text-xs text-muted-foreground">
              {t("distribution.faint", {
                count: faintCount,
                n: context.smallN,
              })}
            </p>
          ) : null}
        </>
      ) : null}
      {data.suppressed > 0 && data.minGroupSize !== null ? (
        <p className="text-sm text-muted-foreground">
          {t("distribution.suppressed", {
            n: data.suppressed,
            min: data.minGroupSize,
          })}
        </p>
      ) : null}
      {rows.length ? (
        <ChartTableToggle
          caption={t("distribution.chart")}
          table={{
            head: [
              t("distribution.group"),
              ...values,
              t("distribution.people"),
              t("distribution.average"),
            ],
            rows: rows.map(({ s, name }) => [
              name,
              ...s.counts,
              s.n,
              s.mean === null ? "" : mean(s.mean),
            ]),
          }}
        />
      ) : null}
    </div>
  );
}
