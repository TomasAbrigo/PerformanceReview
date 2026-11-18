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
        <div className="overflow-x-auto">
          <table className="text-sm" data-testid="alerts-table">
            <thead>
              <tr>
                <th className="p-1 text-left">{t("alerts.kind.label")}</th>
                <th className="p-1 text-left">{t("alerts.person")}</th>
                <th className="p-1 text-left">{t("alerts.manager")}</th>
                <th className="p-1 text-left">{t("alerts.department")}</th>
                <th className="p-1 text-left">{t("alerts.detail")}</th>
              </tr>
            </thead>
            <tbody>
              {data.alerts.map((a) => (
                <tr
                  key={`${a.kind}-${a.person.personId}-${a.kind === "drop" ? a.indicator : ""}`}
                  className="border-t"
                >
                  <td className="p-1">{t(`alerts.kind.${a.kind}`)}</td>
                  <td className="p-1">
                    <Link
                      href={`/insights/indicators/trend?person=${a.person.personId}`}
                      className="underline"
                    >
                      {a.person.name}
                    </Link>
                  </td>
                  <td className="p-1">{a.person.managerName ?? t("none")}</td>
                  <td className="p-1">{a.person.department ?? t("none")}</td>
                  <td className="p-1 tabular-nums">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
