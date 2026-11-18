import { useTranslations } from "next-intl";
import { OrgFilterFields } from "@/components/org/org-filter-fields";
import { hierarchies } from "@/modules/analytics/dashboards/types";
import {
  type IndicatorGroupBy,
  indicatorGroupBys,
  indicators,
} from "@/modules/analytics/indicators/types";
import type { IndicatorFilterOptions } from "@/modules/analytics/indicators/queries";
import type { IndicatorParams } from "./url-state";

type Option = { value: string; label: string };

/** Filters in one row above the charts; a GET form, so they live in the URL. */
export function IndicatorFiltersForm({
  params,
  cycles,
  options,
  groupBys = indicatorGroupBys,
}: {
  params: IndicatorParams;
  cycles: { id: string; name: string }[];
  options: IndicatorFilterOptions;
  /** The groupings on offer (direction is not offered the people). */
  groupBys?: readonly IndicatorGroupBy[];
}) {
  const t = useTranslations("Indicators");
  const select = (
    name: keyof IndicatorParams,
    label: string,
    values: Option[],
    anyLabel: string | null = t("filters.any"),
  ) => (
    <label className="control-label">
      {label}
      <select name={name} defaultValue={params[name] ?? ""} className="control">
        {anyLabel === null ? null : <option value="">{anyLabel}</option>}
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
      aria-label={t("filters.label")}
      className="flex flex-wrap items-end gap-3"
    >
      {select(
        "cycle",
        t("filters.cycle"),
        cycles.map((c) => ({ value: c.id, label: c.name })),
        null,
      )}
      {select(
        "indicator",
        t("indicator.label"),
        indicators.map((i) => ({ value: i, label: t(`indicator.${i}`) })),
        null,
      )}
      {select(
        "groupBy",
        t("groupBy.label"),
        groupBys.map((g) => ({ value: g, label: t(`groupBy.${g}`) })),
        null,
      )}
      {select(
        "hierarchy",
        t("hierarchy.label"),
        hierarchies.map((h) => ({ value: h, label: t(`hierarchy.${h}`) })),
        null,
      )}
      {select(
        "department",
        t("filters.department"),
        options.departments.map((d) => ({ value: d, label: d })),
      )}
      {select(
        "manager",
        t("filters.manager"),
        options.managers.map((m) => ({ value: m.id, label: m.name })),
      )}
      <OrgFilterFields params={params} options={options.org} />
      <button type="submit" className="button-outline">
        {t("filters.apply")}
      </button>
    </form>
  );
}
