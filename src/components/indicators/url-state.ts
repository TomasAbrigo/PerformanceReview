// URL params of the indicator pages (filters live in the URL, never in state).
import { isUuid } from "@/lib/uuid";
import { one, pick } from "@/components/insights/url-state";
import { type OrgParams, parseOrgParams } from "@/components/org/params";
import {
  hierarchies,
  type Hierarchy,
} from "@/modules/analytics/dashboards/types";
import {
  type Indicator,
  type IndicatorGroupBy,
  indicatorGroupBys,
  indicators,
} from "@/modules/analytics/indicators/types";

export type IndicatorParams = OrgParams & {
  cycle?: string;
  indicator: Indicator;
  groupBy: IndicatorGroupBy;
  hierarchy: Hierarchy;
  department?: string;
  manager?: string;
};

type Raw = Record<string, string | string[] | undefined>;

export function parseIndicatorParams(sp: Raw): IndicatorParams {
  const manager = one(sp.manager);
  return {
    ...parseOrgParams(sp),
    cycle: one(sp.cycle),
    indicator: pick(one(sp.indicator), indicators, "retention"),
    groupBy: pick(one(sp.groupBy), indicatorGroupBys, "department"),
    hierarchy: pick(one(sp.hierarchy), hierarchies, "asOf"),
    department: one(sp.department),
    // Something that is not an id cannot match anybody.
    manager: manager && isUuid(manager) ? manager : undefined,
  };
}

/** Params of the trend page: one subject, by person, manager or area. */
export type TrendParams = {
  person?: string;
  manager?: string;
  department?: string;
};

export function parseTrendParams(sp: Raw): TrendParams {
  const id = (v: string | string[] | undefined) => {
    const value = one(v);
    return value && isUuid(value) ? value : undefined;
  };
  return {
    person: id(sp.person),
    manager: id(sp.manager),
    department: one(sp.department),
  };
}
