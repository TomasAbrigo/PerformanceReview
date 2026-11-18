import { useTranslations } from "next-intl";
import { OrgFilterFields } from "@/components/org/org-filter-fields";
import { Link } from "@/i18n/navigation";
import type { AssessmentFilterOptions } from "@/modules/assessments";
import type { AssessmentsParams } from "./url-state";

/**
 * The filters above the participants list, in one row. A GET form, so they
 * live in the URL (and a new search starts at the first page). The person
 * search and the team cuts are left out when the actor only sees themself.
 */
export function AssessmentsFilters({
  params,
  cycleId,
  cycles,
  options,
  ownOnly,
}: {
  params: AssessmentsParams;
  /** The cycle shown (the filter's value). */
  cycleId: string;
  cycles: { id: string; name: string }[];
  options: AssessmentFilterOptions;
  ownOnly: boolean;
}) {
  const f = useTranslations("Assessments.filters");
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
          defaultValue={cycleId}
          className="control max-w-full"
        >
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {ownOnly ? null : (
        <>
          <input type="hidden" name="progress" value={params.progress ?? ""} />
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
          <OrgFilterFields params={params} options={options.org} />
        </>
      )}
      <span className="flex gap-2">
        <button type="submit" className="button-outline">
          {f("apply")}
        </button>
        <Link href="/assessments" className="button-outline">
          {f("clear")}
        </Link>
      </span>
    </form>
  );
}
