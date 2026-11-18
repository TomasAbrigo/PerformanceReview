import { useFormatter, useTranslations } from "next-intl";
import { Sparkline as KitSparkline } from "@/components/charts";
import type { Dm360Point } from "@/modules/analytics/dm-360/types";

/**
 * The retention (solid line) and engagement (dashed line) means of a card
 * over the latest cycles, on the 1-5 scale, as an inline SVG: no chart
 * library, no color-only cue (the two lines differ in dash and the last value
 * of each is a dot), and a text twin for assistive technology.
 */
export function Sparkline({ points }: { points: Dm360Point[] }) {
  const t = useTranslations("Insights360.spark");
  const format = useFormatter();
  const num = (v: number | null) =>
    v === null
      ? t("noData")
      : format.number(v, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        });
  const series = [
    {
      key: "retention" as const,
      className: "stroke-chart-seq fill-chart-seq",
      dash: undefined,
    },
    {
      key: "engagement" as const,
      className: "stroke-chart-sent-mixed fill-chart-sent-mixed",
      dash: "4 3",
    },
  ];
  const text = series
    .map(
      ({ key }) =>
        `${t(key)}: ${points
          .map((p) => t("point", { cycle: p.cycleName, value: num(p[key]) }))
          .join(", ")}`,
    )
    .join(". ");
  return (
    <figure className="flex flex-col gap-1" data-testid="dm-sparkline">
      <KitSparkline
        size="md"
        label={`${t("label")}. ${text}`}
        domain={[1, 5]}
        fmt={(v) => num(v)}
        series={series.map(({ key, className, dash }) => ({
          key,
          color: className,
          dash,
          values: points.map((p) => p[key]),
        }))}
      />
      <figcaption className="sr-only">{text}</figcaption>
    </figure>
  );
}
