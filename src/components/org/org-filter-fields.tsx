import { useTranslations } from "next-intl";
import type { OrgOptions } from "@/modules/org-attributes/kinds";
import type { OrgParams } from "./params";

const FIELDS = [
  ["account", "accounts"],
  ["project", "projects"],
  ["dm", "dms"],
  ["santexLead", "santexLeads"],
] as const;

/**
 * The selects of the org cuts (account, project, DM, Santex Lead) for the
 * filter form of an insights view: put them inside its GET form so the values
 * live in the URL. A select with no values to offer is left out, so a view
 * over people without org attributes (or direction, who is not offered the
 * DMs) shows none of them. `options` null: no filters (nothing is rendered).
 */
export function OrgFilterFields({
  params,
  options,
}: {
  params: OrgParams;
  options: OrgOptions | null;
}) {
  const t = useTranslations("OrgFilters");
  if (!options) return null;
  return (
    <>
      {FIELDS.map(([name, list]) => {
        const values = options[list];
        // A value in the URL that is not on offer (an old link) is still shown.
        const current = params[name];
        const all =
          current && !values.includes(current) ? [current, ...values] : values;
        if (all.length === 0) return null;
        return (
          <label key={name} className="flex flex-col gap-1 text-sm">
            {t(name)}
            <select
              name={name}
              defaultValue={current ?? ""}
              className="rounded-md border bg-background px-2 py-1"
            >
              <option value="">{t("any")}</option>
              {all.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </>
  );
}
