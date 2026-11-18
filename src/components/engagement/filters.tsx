import { useTranslations } from "next-intl";
import { OrgFilterFields } from "@/components/org/org-filter-fields";
import type { EngagementFilterOptions } from "@/modules/analytics/engagement/types";
import type { EngagementParams } from "./params";

/** Filters in one row above the charts; a GET form, so they live in the URL. */
export function EngagementFiltersForm({
  params,
  options,
  /** The range actually shown (what the empty fields default to). */
  range,
}: {
  params: EngagementParams;
  options: EngagementFilterOptions;
  range: { from: string | null; to: string | null };
}) {
  const t = useTranslations("Engagement");
  const month = (value: string | null) => value?.slice(0, 7) ?? "";
  return (
    <form
      method="get"
      aria-label={t("filters.label")}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        {t("filters.from")}
        <input
          type="month"
          name="from"
          defaultValue={params.from ?? month(range.from)}
          min={month(options.firstMonth)}
          max={month(options.lastMonth)}
          className="rounded-md border bg-background px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("filters.to")}
        <input
          type="month"
          name="to"
          defaultValue={params.to ?? month(range.to)}
          min={month(options.firstMonth)}
          max={month(options.lastMonth)}
          className="rounded-md border bg-background px-2 py-1"
        />
      </label>
      {options.departments.length > 0 ? (
        <label className="flex flex-col gap-1 text-sm">
          {t("filters.department")}
          <select
            name="department"
            defaultValue={params.department ?? ""}
            className="rounded-md border bg-background px-2 py-1"
          >
            <option value="">{t("filters.any")}</option>
            {options.departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <OrgFilterFields params={params} options={options.org} />
      <button type="submit" className="rounded-md border px-3 py-1 text-sm">
        {t("filters.apply")}
      </button>
    </form>
  );
}
