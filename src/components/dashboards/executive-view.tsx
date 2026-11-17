import { useTranslations } from "next-intl";
import {
  bins,
  type ExecutiveSummary,
} from "@/modules/analytics/dashboards/types";
import { Meter, Panel } from "./parts";
import { RatingHistogram } from "./rating-histogram";

/**
 * Leadership view: stat tiles + aggregate distribution; never names or ids.
 * Direction's view has a minimum group size: smaller groups arrive folded into
 * "Otros" (or not at all), and a cycle under the minimum only shows its head
 * count.
 */
export function ExecutiveView({ data }: { data: ExecutiveSummary }) {
  const t = useTranslations("Dashboards");
  const min = data.minGroupSize;
  const belowMinimum = min !== null && data.participants < min;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {min === null
          ? t("executive.hintPeople")
          : t("executive.hint", { min })}
      </p>
      <div className="flex flex-wrap gap-4">
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">
            {t("executive.participants")}
          </div>
          <div
            className="text-3xl font-semibold tabular-nums"
            data-testid="exec-participants"
          >
            {data.participants}
          </div>
        </div>
        {data.progress.map((p) => (
          <div
            key={p.relationship}
            className="flex flex-col gap-2 rounded-lg border p-4"
          >
            <div className="text-sm text-muted-foreground">
              {t(`relationships.${p.relationship}`)}
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {p.total ? Math.round((p.submitted / p.total) * 100) : 0} %
            </div>
            <Meter
              width={140}
              value={p.total ? p.submitted / p.total : 0}
              label={t("progress.meter", {
                relationship: t(`relationships.${p.relationship}`),
                submitted: p.submitted,
                total: p.total,
              })}
            />
          </div>
        ))}
      </div>
      {belowMinimum ? (
        <p role="status" className="text-sm">
          {t("executive.belowMinimum", { min })}
        </p>
      ) : (
        <Panel
          id="exec-distribution"
          title={t("distribution.title")}
          hint={t("distribution.hint")}
        >
          <RatingHistogram
            aggregateOnly
            data={{
              bins,
              total: data.distribution,
              series: [
                {
                  key: null,
                  label: null,
                  counts: data.distribution,
                  n: data.distribution.reduce((a, b) => a + b, 0),
                  mean: null,
                },
                ...data.byDepartment.map((d) => ({
                  key: d.department,
                  label: d.department,
                  counts: d.counts,
                  n: d.n,
                  mean: d.mean,
                })),
                ...(data.others
                  ? [
                      {
                        key: "others",
                        label: t("executive.others"),
                        counts: data.others.counts,
                        n: data.others.n,
                        mean: data.others.mean,
                      },
                    ]
                  : []),
              ],
            }}
          />
          <p className="text-sm text-muted-foreground">
            {t("executive.suppressed", { n: data.suppressed })}
          </p>
        </Panel>
      )}
    </div>
  );
}
