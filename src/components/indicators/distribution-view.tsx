import { useFormatter, useTranslations } from "next-intl";
import { HistogramBars } from "@/components/insights/histogram-bars";
import { Empty, TableView } from "@/components/insights/parts";
import {
  INDICATOR_VALUES,
  type IndicatorDistribution,
  type IndicatorSeries,
} from "@/modules/analytics/indicators/types";

/**
 * Distribution of retention or engagement (values 1-5): one small multiple
 * per group (area, manager, or everybody), n and mean in the caption, and a
 * table view. Groups share the y-scale; the total has its own. Direction's
 * groups under the minimum are not here (the note says how many people).
 */
export function DistributionView({ data }: { data: IndicatorDistribution }) {
  const t = useTranslations("Indicators");
  const format = useFormatter();
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
  const max = Math.max(1, ...groups.flatMap((s) => s.counts));
  const figure = (s: IndicatorSeries, name: string, scale: number) => (
    <figure
      key={s.others ? "others" : (s.key ?? name)}
      className="flex flex-col gap-1"
      data-testid="indicator-histogram"
    >
      <figcaption className="text-sm">
        <span className="font-medium">{name}</span>{" "}
        <span className="text-muted-foreground">
          {t("distribution.n", { n: s.n })}
          {s.mean !== null
            ? ` · ${t("distribution.mean", { value: mean(s.mean) })}`
            : ""}
        </span>
      </figcaption>
      <HistogramBars
        max={scale}
        label={`${name}: ${s.counts
          .map((c, i) =>
            t("distribution.valueCount", { value: i + 1, count: c }),
          )
          .join(", ")}`}
        bars={s.counts.map((c, i) => ({
          key: i,
          count: c,
          title: t("distribution.barLabel", {
            group: name,
            value: i + 1,
            count: c,
          }),
          tick: INDICATOR_VALUES[i],
        }))}
      />
    </figure>
  );
  const rows = [
    ...(total ? [{ s: total, name: t("distribution.all") }] : []),
    ...groups.map((s) => ({ s, name: nameOf(s) })),
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? <Empty /> : null}
      <div className="flex flex-wrap gap-6">
        {total
          ? figure(total, t("distribution.all"), Math.max(1, ...total.counts))
          : null}
        {groups.map((s) => figure(s, nameOf(s), max))}
      </div>
      {data.suppressed > 0 && data.minGroupSize !== null ? (
        <p className="text-sm text-muted-foreground">
          {t("distribution.suppressed", {
            n: data.suppressed,
            min: data.minGroupSize,
          })}
        </p>
      ) : null}
      {rows.length ? (
        <TableView
          head={[
            t("distribution.group"),
            ...INDICATOR_VALUES.map(String),
            t("distribution.people"),
            t("distribution.average"),
          ]}
          rows={rows.map(({ s, name }) => [
            name,
            ...s.counts,
            s.n,
            s.mean === null ? "" : mean(s.mean),
          ])}
        />
      ) : null}
    </div>
  );
}
