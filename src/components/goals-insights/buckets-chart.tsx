import { useTranslations } from "next-intl";
import type { GoalsVsIndicators } from "@/modules/analytics/goals-insights/types";
import { Empty, TableView, useDecimal, usePct } from "./shared";

const GROUP_W = 76;
const BAR_W = 26;
const H = 120;
const TOP = 16;
const LEFT = 28;
const W = LEFT + GROUP_W * 5 + 8;

/**
 * Mean retention and engagement (Likert 1-5) of the people of each goals
 * completion bucket: two bars per bucket (retention in the sequential hue,
 * engagement in a neutral one, told apart by the legend and the direct
 * labels), the bucket's people under it. Buckets nobody falls in are empty;
 * the ones direction may not see (under the minimum) are labelled hidden.
 */
export function BucketsChart({ data }: { data: GoalsVsIndicators }) {
  const t = useTranslations("GoalsInsights");
  const decimal = useDecimal();
  const pct = usePct();
  const shownPeople = data.buckets.reduce((n, b) => n + (b.people ?? 0), 0);
  if (shownPeople === 0 && data.suppressed === 0) return <Empty />;
  const y = (v: number) => TOP + (1 - v / 5) * H;
  const bucketName = (b: { from: number; to: number }) =>
    t("buckets.bucket", { from: b.from, to: b.to });
  const series = [
    {
      key: "meanRetention",
      name: t("indicator.retention"),
      cls: "fill-chart-seq",
    },
    {
      key: "meanEngagement",
      name: t("indicator.engagement"),
      cls: "fill-chart-3",
    },
  ] as const;
  const describe = (b: GoalsVsIndicators["buckets"][number]) =>
    b.hidden
      ? t("buckets.hidden", { min: data.minGroupSize ?? 0 })
      : series
          .map((s) =>
            t("buckets.bar", {
              bucket: bucketName(b),
              indicator: s.name,
              value:
                b[s.key] === null
                  ? t("buckets.noData")
                  : (decimal(b[s.key]) ?? 0),
            }),
          )
          .join("; ");
  return (
    <div className="flex flex-col gap-3" data-testid="buckets-chart">
      <ul className="flex gap-4 text-sm" aria-hidden>
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1">
            <svg width={10} height={10}>
              <rect width={10} height={10} rx={2} className={s.cls} />
            </svg>
            {s.name}
          </li>
        ))}
      </ul>
      <svg
        viewBox={`0 0 ${W} ${TOP + H + 40}`}
        className="w-full max-w-md"
        role="img"
        aria-label={`${t("buckets.title")}: ${data.buckets.map(describe).join(". ")}`}
      >
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line
              x1={LEFT}
              x2={W - 8}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
            />
            <text
              x={LEFT - 4}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[12px]"
            >
              {v}
            </text>
          </g>
        ))}
        {data.buckets.map((b, i) => {
          const gx = LEFT + i * GROUP_W + 6;
          return (
            <g key={b.from}>
              <title>{describe(b)}</title>
              <rect
                x={gx - 6}
                y={TOP}
                width={GROUP_W}
                height={H + 36}
                fill="transparent"
              />
              {series.map((s, j) => {
                const value = b[s.key];
                if (value === null) return null;
                const h = Math.max((value / 5) * H, 4);
                const x = gx + j * (BAR_W + 4);
                return (
                  <g key={s.key}>
                    <path
                      className={s.cls}
                      d={`M${x},${TOP + H} v${-(h - 4)} q0,-4 4,-4 h${BAR_W - 8} q4,0 4,4 v${h - 4} z`}
                    />
                    <text
                      x={x + BAR_W / 2}
                      y={TOP + H - h - 3}
                      textAnchor="middle"
                      className="fill-foreground text-[12px] tabular-nums"
                    >
                      {decimal(value)}
                    </text>
                  </g>
                );
              })}
              {b.hidden ? (
                <text
                  x={gx + BAR_W}
                  y={TOP + H - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[12px]"
                >
                  –
                </text>
              ) : null}
              <text
                x={gx + BAR_W}
                y={TOP + H + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[12px]"
              >
                {bucketName(b)}
              </text>
              <text
                x={gx + BAR_W}
                y={TOP + H + 27}
                textAnchor="middle"
                className="fill-muted-foreground text-[12px]"
              >
                {b.people === null
                  ? "n < " + (data.minGroupSize ?? 0)
                  : `n = ${b.people}`}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {data.withoutGoals ? (
          <li>{t("buckets.withoutGoals", { n: data.withoutGoals })}</li>
        ) : null}
        {data.suppressed > 0 ? (
          <li>{t("buckets.suppressed", { n: data.suppressed })}</li>
        ) : null}
      </ul>
      <TableView
        head={[
          t("buckets.columns.bucket"),
          t("buckets.columns.people"),
          t("buckets.columns.retention"),
          t("buckets.columns.engagement"),
          t("buckets.columns.positive"),
        ]}
        rows={data.buckets.map((b) => [
          bucketName(b),
          b.hidden
            ? t("buckets.hidden", { min: data.minGroupSize ?? 0 })
            : (b.people ?? 0),
          decimal(b.meanRetention) ?? t("buckets.noData"),
          decimal(b.meanEngagement) ?? t("buckets.noData"),
          b.meanPositiveShare === null
            ? t("buckets.noData")
            : `${pct(b.meanPositiveShare * 100)} %`,
        ])}
      />
    </div>
  );
}
