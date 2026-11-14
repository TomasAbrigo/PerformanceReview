import { useTranslations } from "next-intl";
import type { RatingDistribution } from "@/modules/analytics/dashboards/types";
import { Empty, pct, TableView } from "./parts";

const BAR_W = 28;
const GAP = 8;
const H = 96;

/**
 * Normalized rating distribution, per dataviz skill (same marks as the
 * calibration histogram): one small multiple per group, single sequential
 * hue, shared y-scale, 4px rounded bar tops on the baseline, direct count
 * labels, a hover tooltip per bar and a table view.
 */
export function RatingHistogram({
  data,
  aggregateOnly = false,
}: {
  data: RatingDistribution;
  aggregateOnly?: boolean;
}) {
  const t = useTranslations("Dashboards");
  if (!data.series.length) return <Empty />;
  const binLabel = (i: number) =>
    t("distribution.bin", {
      from: pct(data.bins[i].from)!,
      to: pct(data.bins[i].to)!,
    });
  const label = (l: string | null) =>
    l ?? (aggregateOnly ? t("distribution.all") : t("none"));
  const max = Math.max(1, ...data.series.flatMap((s) => s.counts));
  const width = data.bins.length * (BAR_W + GAP);
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
            <svg
              width={width}
              height={H + 32}
              role="img"
              aria-label={`${label(s.label)}: ${s.counts
                .map((c, i) => `${binLabel(i)} ${c}`)
                .join(", ")}`}
            >
              <line
                x1={0}
                x2={width}
                y1={H + 14}
                y2={H + 14}
                className="stroke-border"
              />
              {s.counts.map((c, i) => {
                const h = (c / max) * H;
                const x = i * (BAR_W + GAP) + GAP / 2;
                return (
                  <g key={i}>
                    <title>
                      {t("distribution.barLabel", {
                        group: label(s.label),
                        bin: binLabel(i),
                        count: c,
                      })}
                    </title>
                    <rect
                      x={x - GAP / 2}
                      y={0}
                      width={BAR_W + GAP}
                      height={H + 30}
                      fill="transparent"
                    />
                    {h > 0 ? (
                      <path
                        className="fill-chart-seq"
                        d={`M${x},${H + 14} v${-(Math.max(h, 4) - 4)} q0,-4 4,-4 h${BAR_W - 8} q4,0 4,4 v${Math.max(h, 4) - 4} z`}
                      />
                    ) : null}
                    <text
                      x={x + BAR_W / 2}
                      y={H + 10 - h}
                      textAnchor="middle"
                      className="fill-foreground text-[11px] tabular-nums"
                    >
                      {c}
                    </text>
                    <text
                      x={x + BAR_W / 2}
                      y={H + 28}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px]"
                    >
                      {pct(data.bins[i].to)}
                    </text>
                  </g>
                );
              })}
            </svg>
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
