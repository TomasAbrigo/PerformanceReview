import { useTranslations } from "next-intl";
import { OrgFilterFields } from "@/components/org/org-filter-fields";
import type { GoalInsightsFilterOptions } from "@/modules/analytics/goals-insights/types";
import type { GoalsInsightsParams } from "./url-state";

/** Filters in one row above the views; a GET form, so they live in the URL. */
export function GoalsFilters({
  params,
  cycles,
  options,
}: {
  params: GoalsInsightsParams;
  cycles: { id: string; name: string }[];
  options: GoalInsightsFilterOptions;
}) {
  const t = useTranslations("GoalsInsights.filters");
  const select = (
    name: "cycle" | "department" | "manager",
    label: string,
    values: { value: string; label: string }[],
    any: boolean,
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        name={name}
        defaultValue={params[name] ?? ""}
        className="rounded-md border bg-background px-2 py-1"
      >
        {any ? <option value="">{t("any")}</option> : null}
        {values.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <form
      method="get"
      aria-label={t("label")}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="groupBy" value={params.groupBy} />
      <input type="hidden" name="hierarchy" value={params.hierarchy} />
      <input type="hidden" name="indicator" value={params.indicator} />
      {select(
        "cycle",
        t("cycle"),
        cycles.map((c) => ({ value: c.id, label: c.name })),
        false,
      )}
      {select(
        "department",
        t("department"),
        options.departments.map((d) => ({ value: d, label: d })),
        true,
      )}
      {options.managers.length > 0
        ? select(
            "manager",
            t("manager"),
            options.managers.map((m) => ({ value: m.id, label: m.name })),
            true,
          )
        : null}
      <OrgFilterFields params={params} options={options.org} />
      <button type="submit" className="rounded-md border px-3 py-1 text-sm">
        {t("apply")}
      </button>
    </form>
  );
}
