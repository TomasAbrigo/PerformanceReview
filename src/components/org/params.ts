// URL params of the org cuts every insights view shares (account, project,
// DM, Santex Lead): filters live in the URL, never in state.
import type { OrgFilters } from "@/modules/org-attributes/kinds";

export type OrgParams = OrgFilters;

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** The org cuts of a query string (an empty value is no filter). */
export function parseOrgParams(sp: Raw): OrgParams {
  return {
    account: one(sp.account),
    project: one(sp.project),
    dm: one(sp.dm),
    santexLead: one(sp.santexLead),
  };
}

/** The same, as the filters the modules take. */
export const orgFiltersOf = (p: OrgParams): OrgFilters => ({
  account: p.account,
  project: p.project,
  dm: p.dm,
  santexLead: p.santexLead,
});
