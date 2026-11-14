import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { FilterOptions } from "@/modules/analytics/dashboards";
import { type DashboardParams, hrefWith } from "./url-state";

/** A row of link toggles (aria-current marks the active one). */
export function Toggle<T extends string>({
  label,
  options,
  current,
  hrefFor,
  text,
}: {
  label: string;
  options: readonly T[];
  current: T;
  hrefFor: (v: T) => string;
  text: (v: T) => string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1 text-sm"
    >
      <span className="text-muted-foreground">{label}:</span>
      {options.map((o) => (
        <Link
          key={o}
          href={hrefFor(o)}
          aria-current={o === current ? "true" : undefined}
          className={`rounded-md border px-2 py-1 ${o === current ? "bg-foreground text-background" : ""}`}
        >
          {text(o)}
        </Link>
      ))}
    </div>
  );
}

/** Filters in one row above the charts; a GET form, so they live in the URL. */
export function FiltersForm({
  params,
  cycles,
  options,
}: {
  params: DashboardParams;
  cycles: { id: string; name: string }[];
  options: FilterOptions;
}) {
  const t = useTranslations("Dashboards");
  const select = (
    name: keyof DashboardParams,
    label: string,
    values: { value: string; label: string }[],
    anyLabel = t("filters.any"),
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        name={name}
        defaultValue={params[name] ?? ""}
        className="rounded-md border bg-background px-2 py-1"
      >
        <option value="">{anyLabel}</option>
        {values.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
    </label>
  );
  const asValues = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));
  return (
    <form
      method="get"
      aria-label={t("filters.label")}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="hierarchy" value={params.hierarchy} />
      <input type="hidden" name="groupBy" value={params.groupBy} />
      <input type="hidden" name="stage" value={params.stage} />
      {select(
        "cycle",
        t("filters.cycle"),
        cycles.map((c) => ({ value: c.id, label: c.name })),
        t("filters.allCycles"),
      )}
      {select(
        "department",
        t("filters.department"),
        asValues(options.departments),
      )}
      {select(
        "manager",
        t("filters.manager"),
        options.managers.map((m) => ({ value: m.id, label: m.name })),
      )}
      {select("location", t("filters.location"), asValues(options.locations))}
      {select("jobTitle", t("filters.jobTitle"), asValues(options.jobTitles))}
      <button type="submit" className="rounded-md border px-3 py-1 text-sm">
        {t("filters.apply")}
      </button>
    </form>
  );
}

export { hrefWith };
