// URL params of the monthly engagement view (filters live in the URL, never in state).
import { type OrgParams, parseOrgParams } from "@/components/org/params";
import { parseEngagementMonth } from "@/modules/engagement/kinds";

export type EngagementParams = OrgParams & {
  /** `YYYY-MM` (what a month input holds). */
  from?: string;
  to?: string;
  department?: string;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
/** A month of the query string as `YYYY-MM`; anything that is not one is no filter. */
const month = (v: string | string[] | undefined) => {
  const iso = parseEngagementMonth(one(v));
  return iso ? iso.slice(0, 7) : undefined;
};

export function parseEngagementParams(sp: Raw): EngagementParams {
  return {
    ...parseOrgParams(sp),
    from: month(sp.from),
    to: month(sp.to),
    department: one(sp.department),
  };
}

/** The first day of the month of a `YYYY-MM` param, for the queries. */
export const monthStart = (value: string | undefined) =>
  value ? `${value}-01` : undefined;
