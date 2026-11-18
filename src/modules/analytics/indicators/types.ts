// Drizzle- and server-free: shared by the queries and client components.
import { type OrgFilters, orgGroupBys } from "@/modules/org-attributes/kinds";

/**
 * The two closed questions of the assessment, answered by the manager (Likert
 * 1-5, hidden from the employee): `question_revision.role` of each.
 */
export const indicators = ["retention", "engagement"] as const;
export type Indicator = (typeof indicators)[number];

/**
 * Dimension of the distribution: the snapshot's area or manager, an org
 * attribute (account, project, DM, Santex Lead), or no grouping.
 */
export const indicatorGroupBys = [
  "department",
  "manager",
  ...orgGroupBys,
  "none",
] as const;
export type IndicatorGroupBy = (typeof indicatorGroupBys)[number];

/** Likert values; `counts[i]` of a series is the count of value `i + 1`. */
export const INDICATOR_VALUES = [1, 2, 3, 4, 5] as const;
export const VALUE_COUNT = INDICATOR_VALUES.length;

/** Thresholds and minimum group size: the settings `alerts.*` and `aggregation.minGroupSize`. */
export type IndicatorConfig = {
  /** An indicator that fell by this many points or more between cycles is an alert. */
  dropThreshold: number;
  /** Retention and engagement both at or below this is a risk. */
  riskThreshold: number;
  /** Direction only sees groups of at least this many people. */
  minGroupSize: number;
};

export type IndicatorFilters = OrgFilters & {
  department?: string;
  managerId?: string;
};

// ------------------------------------------------------------ distribution

export type IndicatorSeries = {
  key: string | null;
  label: string | null;
  /** The "others" bucket: groups under the minimum folded together (direction). */
  others: boolean;
  counts: number[];
  n: number;
  mean: number | null;
};

export type IndicatorDistribution = {
  cycleId: string;
  indicator: Indicator;
  groupBy: IndicatorGroupBy;
  series: IndicatorSeries[];
  /** Everybody together; null when direction cannot see it (small or differencing). */
  total: IndicatorSeries | null;
  /** People left out because their group is under the minimum (direction). */
  suppressed: number;
  /** The minimum group size applied (direction), else null. */
  minGroupSize: number | null;
};

// ------------------------------------------------------------------- trend

export type TrendSubject =
  | { kind: "person"; personId: string; name: string }
  | { kind: "manager"; managerId: string; name: string }
  | { kind: "department"; department: string }
  | { kind: "all" };

export type TrendPoint = {
  cycleId: string;
  cycleName: string;
  periodStart: string;
  /** Null when suppressed (direction, under the minimum). */
  n: number | null;
  mean: number | null;
  counts: number[] | null;
  suppressed: boolean;
};

export type IndicatorTrend = {
  indicator: Indicator;
  subject: TrendSubject;
  points: TrendPoint[];
  minGroupSize: number | null;
};

// ------------------------------------------------------------ risk matrix

export const bands = ["low", "mid", "high"] as const;
export type Band = (typeof bands)[number];

/**
 * Band of a value: low up to the risk threshold, high from the mirror value
 * (5 - threshold + 1) on, mid between. With the default 2: 1-2, 3, 4-5.
 */
export function bandOf(value: number, riskThreshold: number): Band {
  if (value <= riskThreshold) return "low";
  const highFrom = Math.max(riskThreshold + 1, VALUE_COUNT + 1 - riskThreshold);
  return value >= highFrom ? "high" : "mid";
}

export type MatrixCell = {
  retention: Band;
  engagement: Band;
  /** Null when direction cannot see it (under the minimum). */
  count: number | null;
  /** Both indicators low. */
  risk: boolean;
};

export type RiskPerson = {
  personId: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
  department: string | null;
  retention: number;
  engagement: number;
};

export type RiskMatrix = {
  cycleId: string;
  riskThreshold: number;
  /** Always the nine cells, retention bands × engagement bands. */
  cells: MatrixCell[];
  /** People with both indicators answered; null when direction cannot see it. */
  total: number | null;
  riskCount: number | null;
  /**
   * The people in the risk quadrant, for those who may name people (People:
   * everybody; a manager: their direct reports); null for direction.
   */
  atRisk: RiskPerson[] | null;
  suppressed: boolean;
  minGroupSize: number | null;
};

// ------------------------------------------------------------------ alerts

export type AlertPerson = {
  personId: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
  department: string | null;
};

export type IndicatorAlert =
  | {
      kind: "drop";
      indicator: Indicator;
      person: AlertPerson;
      previousCycleId: string;
      previousCycleName: string;
      previousValue: number;
      value: number;
      /** previous - current: how many points it fell. */
      delta: number;
    }
  | {
      kind: "risk";
      person: AlertPerson;
      retention: number;
      engagement: number;
    };

export type IndicatorAlerts = {
  cycleId: string;
  dropThreshold: number;
  riskThreshold: number;
  /** People with a drop / at risk; null when direction cannot see it (under the minimum). */
  peopleWithDrop: number | null;
  peopleAtRisk: number | null;
  /** The alerts with their person: People and the direct manager (the same people as the risk list); empty for direction. */
  alerts: IndicatorAlert[];
  minGroupSize: number | null;
};

/**
 * Values of a band: low is 1 up to the risk threshold, high runs from the
 * mirror value to 5; null when the band is empty (a high threshold).
 */
export function bandRange(
  band: Band,
  riskThreshold: number,
): [number, number] | null {
  const highFrom = Math.max(riskThreshold + 1, VALUE_COUNT + 1 - riskThreshold);
  const range: [number, number] =
    band === "low"
      ? [1, riskThreshold]
      : band === "high"
        ? [highFrom, VALUE_COUNT]
        : [riskThreshold + 1, highFrom - 1];
  return range[0] <= range[1] ? range : null;
}
