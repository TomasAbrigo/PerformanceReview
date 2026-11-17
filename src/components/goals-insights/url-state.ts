// URL params of /insights/goals (filters live in the URL, never in state).
import {
  type GoalGroupBy,
  goalGroupBys,
  type Hierarchy,
  type Indicator,
  indicators,
} from "@/modules/analytics/goals-insights/types";
import { hierarchies } from "@/modules/analytics/dashboards/types";

export type GoalsInsightsParams = {
  cycle?: string;
  groupBy: GoalGroupBy;
  hierarchy: Hierarchy;
  /** Indicator of the scatter. */
  indicator: Indicator;
  department?: string;
  manager?: string;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;
const pick = <T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(v as T) ? (v as T) : fallback);

export function parseGoalsInsightsParams(sp: Raw): GoalsInsightsParams {
  return {
    cycle: one(sp.cycle),
    groupBy: pick(one(sp.groupBy), goalGroupBys, "department"),
    hierarchy: pick(one(sp.hierarchy), hierarchies, "asOf"),
    indicator: pick(one(sp.indicator), indicators, "retention"),
    department: one(sp.department),
    manager: one(sp.manager),
  };
}

/** `path?…` with the params (overrides applied, empty values dropped). */
export function hrefWith(
  path: string,
  p: Partial<GoalsInsightsParams>,
  overrides: Partial<GoalsInsightsParams> = {},
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...overrides })) {
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
