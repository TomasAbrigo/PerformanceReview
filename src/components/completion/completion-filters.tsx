import { useTranslations } from "next-intl";
import { Toggle } from "@/components/dashboards/controls";
import type { FilterOptions } from "@/modules/analytics/dashboards";
import {
  type CompletionGroupBy,
  type MissingStatus,
  missingStatuses,
} from "@/modules/analytics/completion/types";
import { hierarchies } from "@/modules/analytics/dashboards/types";
import { type CompletionParams, completionHref } from "./params";

/**
 * Filters above the panels: a GET form (cycle, area, manager) so they live in
 * the URL, and link toggles for the grouping and the hierarchy. `options` is
 * null for direction, who reads aggregates and cannot filter by area or manager.
 */
export function CompletionFilters({
  params,
  cycles,
  options,
  groupBys,
}: {
  /** The cycle is the one shown. */
  params: CompletionParams;
  cycles: { id: string; name: string }[];
  options: FilterOptions | null;
  groupBys: readonly CompletionGroupBy[];
}) {
  const t = useTranslations("Completion");
  const select = (
    name: "cycle" | "department" | "manager",
    label: string,
    values: { value: string; label: string }[],
    anyLabel: string | null = t("filters.any"),
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        name={name}
        defaultValue={params[name] ?? ""}
        className="rounded-md border bg-background px-2 py-1"
      >
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
    <div className="flex flex-col gap-3">
      <form
        method="get"
        aria-label={t("filters.label")}
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="groupBy" value={params.groupBy} />
        <input type="hidden" name="hierarchy" value={params.hierarchy} />
        <input type="hidden" name="status" value={params.status} />
        {select(
          "cycle",
          t("filters.cycle"),
          cycles.map((c) => ({ value: c.id, label: c.name })),
          null,
        )}
        {options
          ? select(
              "department",
              t("filters.department"),
              options.departments.map((d) => ({ value: d, label: d })),
            )
          : null}
        {options
          ? select(
              "manager",
              t("filters.manager"),
              options.managers.map((m) => ({ value: m.id, label: m.name })),
            )
          : null}
        <button type="submit" className="rounded-md border px-3 py-1 text-sm">
          {t("filters.apply")}
        </button>
      </form>
      <div className="flex flex-wrap gap-4">
        <Toggle
          label={t("groupBy.label")}
          options={groupBys}
          current={params.groupBy}
          hrefFor={(g) => completionHref(params, { groupBy: g })}
          text={(g) => t(`groupBy.${g}`)}
        />
        <Toggle
          label={t("hierarchy.label")}
          options={hierarchies}
          current={params.hierarchy}
          hrefFor={(h) => completionHref(params, { hierarchy: h })}
          text={(h) => t(`hierarchy.${h}`)}
        />
      </div>
    </div>
  );
}

/** The side of the "quién falta" list to look at (any, self, manager). */
export function MissingStatusToggle({ params }: { params: CompletionParams }) {
  const t = useTranslations("Completion.missing.status");
  return (
    <Toggle<MissingStatus>
      label={t("label")}
      options={missingStatuses}
      current={params.status}
      hrefFor={(s) => completionHref(params, { status: s })}
      text={(s) => t(s)}
    />
  );
}
