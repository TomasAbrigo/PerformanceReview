import { CardCollection } from "@/components/card-collection";
import { TrendingDown, ShieldAlert } from "lucide-react";
import { IconTile } from "@/components/experience";
import { useTranslations } from "next-intl";
import { Empty } from "@/components/insights/parts";
import { Link } from "@/i18n/navigation";
import type { IndicatorAlerts } from "@/modules/analytics/indicators/types";

/**
 * The alerts of a cycle: falls and risks, with the person for People and the
 * direct manager. Direction gets only the counts (when at least the minimum).
 */
export function AlertsView({ data }: { data: IndicatorAlerts }) {
  const t = useTranslations("Indicators");
  const count = (n: number | null) =>
    n === null ? t("alerts.under", { min: data.minGroupSize ?? 0 }) : `${n}`;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" data-testid="alerts-summary">
        {t("alerts.summary", {
          drop: count(data.peopleWithDrop),
          risk: count(data.peopleAtRisk),
        })}
      </p>
      {data.minGroupSize !== null ? (
        <p className="text-sm text-muted-foreground">
          {t("alerts.aggregateOnly")}
        </p>
      ) : data.alerts.length === 0 ? (
        <Empty />
      ) : (
        <CardCollection
          gridClassName="dense-list"
          data-testid="alerts-table"
          initialCount={10}
        >
          {data.alerts.map((a) => (
            <article
              key={`${a.kind}-${a.person.personId}-${a.kind === "drop" ? a.indicator : ""}`}
              className="dense-row dense-row-wide"
              aria-label={a.person.name}
            >
              <div className="flex items-center gap-3">
                <IconTile className="size-9 bg-status-progress-bg text-foreground">
                  {a.kind === "drop" ? (
                    <TrendingDown className="size-4" />
                  ) : (
                    <ShieldAlert className="size-4" />
                  )}
                </IconTile>
                <div className="dense-name">
                  <Link
                    href={`/insights/indicators/trend?person=${a.person.personId}`}
                    className="font-medium"
                  >
                    {a.person.name}
                  </Link>
                  <small>
                    {a.person.department ?? t("none")} · {t("alerts.manager")}:{" "}
                    {a.person.managerName ?? t("none")}
                  </small>
                </div>
              </div>
              <span className="delta-pill delta-down self-start">
                {t(`alerts.kind.${a.kind}`)}
              </span>
              <p className="text-sm">
                {a.kind === "drop"
                  ? t("alerts.dropDetail", {
                      indicator: t(`indicator.${a.indicator}`),
                      previous: a.previousValue,
                      value: a.value,
                      delta: a.delta,
                      cycle: a.previousCycleName,
                    })
                  : t("alerts.riskDetail", {
                      retention: a.retention,
                      engagement: a.engagement,
                    })}
              </p>
            </article>
          ))}
        </CardCollection>
      )}
    </div>
  );
}
