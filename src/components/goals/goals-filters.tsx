import { useTranslations } from "next-intl";
import { AdvancedFilters } from "@/components/experience";
import { OrgFilterFields } from "@/components/org/org-filter-fields";
import { Link } from "@/i18n/navigation";
import type { GoalFilterOptions } from "@/modules/goals/browse";
import type { GoalsParams } from "./url-state";

/**
 * The controls of the goals list, as the canvas draws them: the cycle always
 * visible, the person search, the area and the team cuts behind "Más
 * filtros". A GET form, so they live in the URL (and a new search starts at
 * the first page). The person search and the team cuts are left out when the
 * actor only sees their own goals.
 */
export function GoalsFilters({
  params,
  cycles,
  options,
  ownOnly,
}: {
  params: GoalsParams;
  cycles: { id: string; name: string }[];
  options: GoalFilterOptions;
  ownOnly: boolean;
}) {
  const f = useTranslations("Goals.filters");
  const advancedActive =
    !ownOnly &&
    Boolean(
      params.q ||
      params.department ||
      params.account ||
      params.project ||
      params.dm ||
      params.santexLead,
    );
  return (
    <form
      method="get"
      aria-label={f("label")}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="control-label max-w-full">
        {f("cycle")}
        <select
          name="cycle"
          defaultValue={params.cycle ?? ""}
          className="control max-w-full"
        >
          <option value="">{f("anyCycle")}</option>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <input type="hidden" name="state" value={params.state ?? ""} />
      {ownOnly ? null : (
        <AdvancedFilters active={advancedActive}>
          <label className="control-label max-w-full">
            {f("person")}
            <input
              type="search"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder={f("personPlaceholder")}
              className="control max-w-full"
            />
          </label>
          {options.departments.length > 0 ? (
            <label className="control-label max-w-full">
              {f("department")}
              <select
                name="department"
                defaultValue={params.department ?? ""}
                className="control max-w-full"
              >
                <option value="">{f("anyDepartment")}</option>
                {options.departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <OrgFilterFields params={params} options={options.org} bare />
        </AdvancedFilters>
      )}
      <span className="flex gap-2">
        <button type="submit" className="button-outline">
          {f("apply")}
        </button>
        <Link href="/goals" className="button-outline">
          {f("clear")}
        </Link>
      </span>
    </form>
  );
}
