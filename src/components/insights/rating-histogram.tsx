import { useTranslations } from "next-intl";
import { ChartTableToggle, Histogram } from "@/components/charts";
import type { RatingDistribution } from "@/modules/analytics/dashboards/types";
import { Empty, pct } from "./parts";

/**
 * Normalized rating distribution with the kit Histogram: one small multiple
 * per group (shared height scale), count and share written on each bar, the
 * bins as percent ranges, a caption with n and mean, and the table twin.
 */
export function RatingHistogram({
  data,
  aggregateOnly = false,
}: {
  data: RatingDistribution;
  aggregateOnly?: boolean;
}) {
  const t = useTranslations("Charts");
  if (!data.series.length || data.series.every((s) => s.n === 0))
    return <Empty />;
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
      <div className="flex flex-wrap gap-8">
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
            <Histogram
              max={max}
              xTitle={t("distribution.xTitle")}
              label={`${label(s.label)}: ${s.counts
                .map((c, i) => `${binLabel(i)} ${c}`)
                .join(", ")}`}
              bins={s.counts.map((c, i) => ({
                key: String(i),
                count: c,
                tip: t("distribution.barLabel", {
                  group: label(s.label),
                  bin: binLabel(i),
                  count: c,
                }),
                tick: binLabel(i),
              }))}
            />
          </figure>
        ))}
      </div>
      <ChartTableToggle
        caption={t("distribution.title")}
        table={{
          head: [
            t("distribution.group"),
            ...data.bins.map((_, i) => binLabel(i)),
          ],
          rows: data.series.map((s) => [label(s.label), ...s.counts]),
        }}
      />
    </div>
  );
}
