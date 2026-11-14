// URL params of the dashboards (filters live in the URL, never in state).
import {
  type GroupBy,
  groupBys,
  type Hierarchy,
  hierarchies,
  type RatingStage,
  ratingStages,
} from "@/modules/analytics/dashboards/types";

export type DashboardParams = {
  cycle?: string;
  hierarchy: Hierarchy;
  groupBy: GroupBy;
  stage: RatingStage;
  department?: string;
  manager?: string;
  location?: string;
  jobTitle?: string;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;
const pick = <T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(v as T) ? (v as T) : fallback);

export function parseParams(sp: Raw): DashboardParams {
  return {
    cycle: one(sp.cycle),
    hierarchy: pick(one(sp.hierarchy), hierarchies, "asOf"),
    groupBy: pick(one(sp.groupBy), groupBys, "department"),
    stage: pick(one(sp.stage), ratingStages, "current"),
    department: one(sp.department),
    manager: one(sp.manager),
    location: one(sp.location),
    jobTitle: one(sp.jobTitle),
  };
}

/** `path?…` with the params (overrides applied, empty values dropped). */
export function hrefWith(
  path: string,
  p: Partial<DashboardParams>,
  overrides: Partial<DashboardParams> = {},
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...overrides })) {
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
