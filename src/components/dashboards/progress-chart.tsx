import { useTranslations } from "next-intl";
import type { CycleProgress } from "@/modules/analytics/dashboards/types";
import { Empty, Meter, TableView } from "./parts";

/**
 * Cycle progress: one meter per review type (submitted of total) plus the
 * breakdown by department × manager in the table view. Managers are absent
 * when the data comes aggregate-only.
 */
export function ProgressChart({ data }: { data: CycleProgress }) {
  const t = useTranslations("Dashboards");
  if (!data.rows.length) return <Empty />;
  const showManager = data.rows.some((r) => r.managerName !== null);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {data.totals.map((x) => {
          const label = t("progress.meter", {
            relationship: t(`relationships.${x.relationship}`),
            submitted: x.submitted,
            total: x.total,
          });
          return (
            <li
              key={x.relationship}
              className="flex flex-wrap items-center gap-3 text-sm"
            >
              <span className="w-44">
                {t(`relationships.${x.relationship}`)}
              </span>
              <Meter
                value={x.total ? x.submitted / x.total : 0}
                label={label}
              />
              <span className="tabular-nums">
                {x.submitted}/{x.total}
              </span>
            </li>
          );
        })}
      </ul>
      <TableView
        head={[
          t("progress.relationship"),
          t("filters.department"),
          ...(showManager ? [t("filters.manager")] : []),
          t("progress.total"),
          t("statuses.submitted"),
          t("statuses.draft"),
          t("statuses.declined"),
        ]}
        rows={data.rows.map((r) => [
          t(`relationships.${r.relationship}`),
          r.department ?? t("none"),
          ...(showManager ? [r.managerName ?? t("none")] : []),
          r.total,
          r.submitted,
          r.draft,
          r.declined,
        ])}
      />
    </div>
  );
}
