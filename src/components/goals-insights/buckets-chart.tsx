import { useTranslations } from "next-intl";
import type { GoalsVsIndicators } from "@/modules/analytics/goals-insights/types";
import { ChartLegend, GroupedBars } from "@/components/charts";
import { Empty, TableView, useDecimal, usePct } from "./shared";

/**
 * Mean retention and engagement (Likert 1-5) of the people of each goals
 * completion bucket: two bars per bucket (retention in the sequential hue,
 * engagement in a neutral one, told apart by the legend and the direct
 * labels), under it the n of each bar: the people of the bucket WHO HAVE that
 * answer (not everybody with goals). Buckets nobody falls in are empty; the
 * ones direction may not see (under the minimum) are labelled hidden, and so
 * is an indicator whose own n is under it.
 */
export function BucketsChart({ data }: { data: GoalsVsIndicators }) {
  const t = useTranslations("GoalsInsights");
  const decimal = useDecimal();
  const pct = usePct();
  const shownPeople = data.buckets.reduce((n, b) => n + (b.people ?? 0), 0);
  if (shownPeople === 0 && data.suppressed === 0) return <Empty />;
  const bucketName = (b: { from: number; to: number }) =>
    t("buckets.bucket", { from: b.from, to: b.to });
  const series = [
    {
      key: "meanRetention",
      name: t("indicator.retention"),
      cls: "bg-chart-seq",
    },
    {
      key: "meanEngagement",
      name: t("indicator.engagement"),
      cls: "bg-chart-sent-mixed",
    },
  ] as const;
  const baseOf = (
    b: GoalsVsIndicators["buckets"][number],
    key: (typeof series)[number]["key"],
  ) => (key === "meanRetention" ? b.retentionPeople : b.engagementPeople);
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
              n: baseOf(b, s.key) ?? `< ${data.minGroupSize ?? 0}`,
            }),
          )
          .join("; ");
  // "n = 107 / 107": the people of the bucket with each answer. An indicator
  // under the minimum (direction) is "< min".
  const nOf = (b: GoalsVsIndicators["buckets"][number]) =>
    b.people === null
      ? `n < ${data.minGroupSize ?? 0}`
      : t("buckets.n", {
          retention: b.retentionPeople ?? `< ${data.minGroupSize ?? 0}`,
          engagement: b.engagementPeople ?? `< ${data.minGroupSize ?? 0}`,
        });
  return (
    <div className="flex flex-col gap-3" data-testid="buckets-chart">
      <ChartLegend
        items={series.map((s) => ({
          key: s.key,
          label: s.name,
          swatch: s.cls,
        }))}
      />
      <GroupedBars
        label={`${t("buckets.title")}: ${data.buckets.map(describe).join(". ")}`}
        yTitle={t("buckets.yTitle")}
        xTitle={t("buckets.xTitle")}
        domain={[0, 5]}
        ticks={[1, 2, 3, 4, 5]}
        fmt={(v) => decimal(v) ?? ""}
        series={series.map((s) => ({ key: s.key, label: s.name, fill: s.cls }))}
        groups={data.buckets.map((b) => ({
          key: String(b.from),
          label: bucketName(b),
          sub: nOf(b),
          masked: b.hidden
            ? t("buckets.hidden", { min: data.minGroupSize ?? 0 })
            : undefined,
          values: {
            meanRetention: b.meanRetention,
            meanEngagement: b.meanEngagement,
          },
        }))}
      />
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
          t("buckets.columns.retentionPeople"),
          t("buckets.columns.retention"),
          t("buckets.columns.engagementPeople"),
          t("buckets.columns.engagement"),
          t("buckets.columns.positive"),
        ]}
        rows={data.buckets.map((b) => [
          bucketName(b),
          b.hidden
            ? t("buckets.hidden", { min: data.minGroupSize ?? 0 })
            : (b.people ?? 0),
          b.hidden ? "–" : (b.retentionPeople ?? `< ${data.minGroupSize ?? 0}`),
          decimal(b.meanRetention) ?? t("buckets.noData"),
          b.hidden
            ? "–"
            : (b.engagementPeople ?? `< ${data.minGroupSize ?? 0}`),
          decimal(b.meanEngagement) ?? t("buckets.noData"),
          b.meanPositiveShare === null
            ? t("buckets.noData")
            : `${pct(b.meanPositiveShare * 100)} %`,
        ])}
      />
    </div>
  );
}
