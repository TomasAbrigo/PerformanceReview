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
        <CardCollection gridClassName="record-grid" data-testid="alerts-table">
          {data.alerts.map((a) => (
            <article
              key={`${a.kind}-${a.person.personId}-${a.kind === "drop" ? a.indicator : ""}`}
              className="record-card"
              aria-label={a.person.name}
            >
              <header className="flex items-center justify-between gap-3">
                <IconTile className="bg-status-progress-bg text-foreground">
                  {a.kind === "drop" ? (
                    <TrendingDown className="size-5" />
                  ) : (
                    <ShieldAlert className="size-5" />
                  )}
                </IconTile>
                <span className="delta-pill delta-down">
                  {t(`alerts.kind.${a.kind}`)}
                </span>
              </header>
              <h3 className="text-xl">
                <Link
                  href={`/insights/indicators/trend?person=${a.person.personId}`}
                  className="underline decoration-brand-200 underline-offset-4"
                >
                  {a.person.name}
                </Link>
              </h3>
              <dl className="record-facts">
                <div>
                  <dt>{t("alerts.manager")}</dt>
                  <dd>{a.person.managerName ?? t("none")}</dd>
                </div>
                <div>
                  <dt>{t("alerts.department")}</dt>
                  <dd>{a.person.department ?? t("none")}</dd>
                </div>
              </dl>
              <p className="rounded-lg border-l-4 border-brand-warm bg-status-progress-bg p-4 text-sm leading-relaxed">
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
