// Drizzle- and server-free: shared by the queries and client components.
import type { Hierarchy } from "@/modules/analytics/dashboards/types";

export type { Hierarchy };

/** The two closed questions of the assessment (`question_revision.role`). */
export const indicators = ["retention", "engagement"] as const;
export type Indicator = (typeof indicators)[number];

/** Who the goal figures are grouped by. */
export const goalGroupBys = ["person", "manager", "department"] as const;
export type GoalGroupBy = (typeof goalGroupBys)[number];

export type GoalInsightsFilters = {
  department?: string;
  managerId?: string;
};

/**
 * Likert 1-5 of the indicators and the value a person must reach on both to
 * count as "high": the mirror of the default risk threshold (2 <-> 4).
 */
export const HIGH_INDICATOR = 4;

/** Goals-completed thresholds of the outliers, as whole percentages. */
export const GOALS_HIGH_PCT = 80;
export const GOALS_LOW_PCT = 30;

/**
 * Completion buckets of the goals-vs-indicators aggregate: `BUCKET_COUNT`
 * equal slices of 0-100 %, the last one closed (100 % belongs to it).
 */
export const BUCKET_COUNT = 5;
export const BUCKET_WIDTH = 100 / BUCKET_COUNT;

/**
 * The bucket of a person who completed `completed` of `goals` goals. Integer
 * arithmetic only, so 3 of 5 (60 %) is exactly at the start of the fourth
 * bucket and never a float away from it.
 */
export function bucketOf(completed: number, goals: number): number {
  return Math.min(
    BUCKET_COUNT - 1,
    Math.floor((completed * BUCKET_COUNT) / goals),
  );
}

export const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
  from: i * BUCKET_WIDTH,
  to: (i + 1) * BUCKET_WIDTH,
}));

// --------------------------------------------------------------------- KPIs

/** The goal figures of one group (a person, a manager's team, an area). */
export type GoalKpiGroup = {
  key: string | null;
  label: string | null;
  /** The "others" cell: groups under the minimum folded together (direction). */
  others: boolean;
  /** People of the group (cycle participants). */
  people: number;
  /** People of the group with at least one goal in the period. */
  peopleWithGoals: number;
  goals: number;
  completed: number;
  inProgress: number;
  /** Goals closed in Bamboo without being completed. */
  closed: number;
  /** In progress and due before the cycle's period ended. */
  overdue: number;
  /** Shares of `goals`, 0-100; null without goals. */
  completedPct: number | null;
  inProgressPct: number | null;
  overduePct: number | null;
  /** Mean progress (percent complete) of the goals, 0-100; null without goals. */
  avgProgress: number | null;
};

export type GoalKpis = {
  cycleId: string;
  groupBy: GoalGroupBy;
  hierarchy: Hierarchy;
  groups: GoalKpiGroup[];
  /** Everybody together; null when direction cannot see it (it would give a hidden group away). */
  total: GoalKpiGroup | null;
  /** People left out because their group is under the minimum (direction). */
  suppressed: number;
  /** The minimum group size applied (direction), else null. */
  minGroupSize: number | null;
};

// ------------------------------------------------------ goals vs indicators

/** One participant: goals of the period next to their assessment indicators. */
export type GoalIndicatorRow = {
  participantId: string;
  personId: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
  department: string | null;
  goals: number;
  completed: number;
  inProgress: number;
  /** Closed in Bamboo without being completed. */
  closed: number;
  /** In progress and due before the cycle's period ended. */
  overdue: number;
  /** Sum of the goals' percent complete (the mean is `avgProgress`). */
  progressSum: number;
  /** Completed / goals, 0-100; null without goals. */
  completedPct: number | null;
  avgProgress: number | null;
  /** 1-5 as the manager answered them; null when not answered. */
  retention: number | null;
  engagement: number | null;
  /** Positive share (0-1) of the person's labeled comments; null without labels. */
  positiveShare: number | null;
  labeledComments: number;
};

/** People of one completion bucket with the mean of each indicator. */
export type GoalBucket = {
  from: number;
  to: number;
  /** People with goals in the bucket; null when direction cannot see it (under the minimum). */
  people: number | null;
  meanRetention: number | null;
  meanEngagement: number | null;
  /** Mean of the people's positive shares (people with labeled comments only). */
  meanPositiveShare: number | null;
  /** Direction: the bucket has fewer people than the minimum. */
  hidden: boolean;
};

export type GoalsVsIndicators = {
  cycleId: string;
  /** One row per participant; empty for direction (aggregates only). */
  rows: GoalIndicatorRow[];
  buckets: GoalBucket[];
  /** People without goals in the period (they have no completion); null for direction. */
  withoutGoals: number | null;
  /** People in buckets under the minimum, left out of the aggregate (direction). */
  suppressed: number;
  minGroupSize: number | null;
};

// ---------------------------------------------------------------- outliers

export type GoalOutlier = {
  participantId: string;
  personId: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
  department: string | null;
  goals: number;
  completed: number;
  completedPct: number;
  retention: number | null;
  engagement: number | null;
};

export type GoalOutlierThresholds = {
  /** Goals completed at or above this share (%) count as "done". */
  goalsHigh: number;
  /** Goals completed at or under this share (%) count as "behind". */
  goalsLow: number;
  /** Retention or engagement at or under this is low (setting `alerts.riskThreshold`). */
  riskThreshold: number;
  /** Both indicators at or above this are high. */
  indicatorHigh: number;
};

export type OutlierGroup = {
  /** People in the group; null when direction cannot see it (under the minimum). */
  count: number | null;
  /** The people themselves: People and the direct manager; empty for direction. */
  people: GoalOutlier[];
};

export type GoalOutliers = {
  cycleId: string;
  thresholds: GoalOutlierThresholds;
  /** Goals completed (>= goalsHigh) but retention or engagement low (<= riskThreshold). */
  doneButLow: OutlierGroup;
  /** Goals behind (<= goalsLow) but both indicators high (>= indicatorHigh). */
  behindButHigh: OutlierGroup;
  minGroupSize: number | null;
};

// ---------------------------------------------------------- filter options

export type GoalInsightsFilterOptions = {
  departments: string[];
  /** Empty for direction (it does not see people's names). */
  managers: { id: string; name: string }[];
};
