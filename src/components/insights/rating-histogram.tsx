import { useTranslations } from "next-intl";
import type { RatingDistribution } from "@/modules/analytics/dashboards/types";
import { HistogramBars } from "./histogram-bars";
import { Empty, pct, TableView } from "./parts";

/**
 * Normalized rating distribution, per dataviz skill (same primitive as the
 * calibration histogram): one small multiple per group, shared y-scale, a
 * caption with n and mean, and a table view.
 */
export function RatingHistogram({
  data,
  aggregateOnly = false,
}: {
  data: RatingDistribution;
  aggregateOnly?: boolean;
}) {
  const t = useTranslations("Charts");
  if (!data.series.length) return <Empty />;
  const binLabel = (i: number) =>
    t("distribution.bin", {
      from: pct(data.bins[i].from)!,
      to: pct(data.bins[i].to)!,
    });
  const label = (l: string | null) =>
    l ?? (aggregateOnly ? t("distribution.all") : t("none"));
  const max = Math.max(1, ...data.series.flatMap((s) => s.counts));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-6">
        {data.series.map((s) => (
          <figure
            key={s.key ?? "none"}
            className="flex flex-col gap-1"
            data-testid="histogram"
          >
            <figcaption className="text-sm">
              <span className="font-medium">{label(s.label)}</span>{" "}
              <span className="text-muted-foreground">
                {t("distribution.n", { n: s.n })}
                {s.mean !== null
                  ? ` · ${t("distribution.mean", { value: pct(s.mean)! })}`
                  : ""}
              </span>
            </figcaption>
            <HistogramBars
              max={max}
              label={`${label(s.label)}: ${s.counts
                .map((c, i) => `${binLabel(i)} ${c}`)
                .join(", ")}`}
              bars={s.counts.map((c, i) => ({
                key: i,
                count: c,
                title: t("distribution.barLabel", {
                  group: label(s.label),
                  bin: binLabel(i),
                  count: c,
                }),
                tick: pct(data.bins[i].to)!,
              }))}
            />
          </figure>
        ))}
      </div>
      <TableView
        head={["", ...data.bins.map((_, i) => binLabel(i))]}
        rows={data.series.map((s) => [label(s.label), ...s.counts])}
      />
    </div>
  );
}
