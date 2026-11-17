// Pure and server-free: everything the goals-insights views show is derived
// from the participant rows (see rows.ts), loaded once per request. The
// minimum group size is `null` for readers that see everything (People, a
// manager) and the setting's value for direction.
import { isUuid } from "@/lib/uuid";
import { foldKpiGroups, kpiGroup, type KpiCounts, sumGroups } from "./kpi";
import {
  bucketOf,
  buckets,
  GOALS_HIGH_PCT,
  GOALS_LOW_PCT,
  type GoalBucket,
  type GoalGroupBy,
  type GoalIndicatorRow,
  type GoalInsightsFilterOptions,
  type GoalInsightsFilters,
  type GoalKpiGroup,
  type GoalOutlier,
  type GoalOutlierThresholds,
  type OutlierGroup,
  HIGH_INDICATOR,
} from "./types";

/**
 * The rows of the area and manager that were asked for. An id that is not a
 * uuid is ignored, like the dashboards' filters do (no filter, not an error).
 */
export function filterRows(
  rows: readonly GoalIndicatorRow[],
  filters: GoalInsightsFilters = {},
): GoalIndicatorRow[] {
  const manager =
    filters.managerId && isUuid(filters.managerId)
      ? filters.managerId
      : undefined;
  return rows.filter(
    (r) =>
      (!filters.department || r.department === filters.department) &&
      (!manager || r.managerId === manager),
  );
}

const collator = (a: string, b: string) => a.localeCompare(b, "es");

/**
 * Values of the filter selects: the areas and managers of the (unfiltered)
 * rows. Direction gets the areas only: it never sees a person's name.
 */
export function filterOptionsOf(
  rows: readonly GoalIndicatorRow[],
  named: boolean,
): GoalInsightsFilterOptions {
  const departments = [
    ...new Set(rows.flatMap((r) => (r.department ? [r.department] : []))),
  ].sort(collator);
  const managers = new Map<string, string>();
  if (named) {
    for (const r of rows) {
      if (r.managerId && r.managerName)
        managers.set(r.managerId, r.managerName);
    }
  }
  return {
    departments,
    managers: [...managers]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => collator(a.name, b.name)),
  };
}

// ---------------------------------------------------------------------- KPIs

const dimensions: Record<
  GoalGroupBy,
  (r: GoalIndicatorRow) => { key: string | null; label: string | null }
> = {
  person: (r) => ({ key: r.personId, label: r.name }),
  manager: (r) => ({ key: r.managerId, label: r.managerName }),
  department: (r) => ({ key: r.department, label: r.department }),
};

/** Collator order of the labels, the unlabelled last (by key among themselves). */
const byLabel = (a: GoalKpiGroup, b: GoalKpiGroup) =>
  a.label === null || b.label === null
    ? Number(a.label === null) - Number(b.label === null) ||
      (a.key ?? "").localeCompare(b.key ?? "")
    : collator(a.label, b.label) || (a.key ?? "").localeCompare(b.key ?? "");

/**
 * The goal figures per person, manager or area: what the group's people had
 * in the period, the shares of completed, in progress and overdue goals (of
 * the group's goals) and the mean progress. With a minimum (direction), the
 * groups under it are folded into "Otros", hidden when that is still under
 * it, and the total is dropped if it would give a hidden group away. A
 * manager is a person: with a minimum the teams keep their key (to tell them
 * apart) but never their name, the label is null.
 */
export function kpisOf(
  rows: readonly GoalIndicatorRow[],
  groupBy: GoalGroupBy,
  minGroupSize: number | null,
): {
  groups: GoalKpiGroup[];
  total: GoalKpiGroup | null;
  suppressed: number;
  minGroupSize: number | null;
} {
  const sums = new Map<string, KpiCounts>();
  for (const r of rows) {
    const d = dimensions[groupBy](r);
    // Direction reads teams, not the people who lead them.
    if (minGroupSize !== null && groupBy === "manager") d.label = null;
    const id = d.key ?? "\u0000";
    const c = sums.get(id) ?? {
      key: d.key,
      label: d.label,
      people: 0,
      peopleWithGoals: 0,
      goals: 0,
      completed: 0,
      inProgress: 0,
      closed: 0,
      overdue: 0,
      progressSum: 0,
    };
    c.people += 1;
    c.peopleWithGoals += r.goals > 0 ? 1 : 0;
    c.goals += r.goals;
    c.completed += r.completed;
    c.inProgress += r.inProgress;
    c.closed += r.closed;
    c.overdue += r.overdue;
    c.progressSum += r.progressSum;
    sums.set(id, c);
  }
  const all = [...sums.values()].map(kpiGroup).sort(byLabel);
  const total = sumGroups(all, { key: null, label: null });
  if (minGroupSize === null) {
    return { groups: all, total, suppressed: 0, minGroupSize: null };
  }
  const { shown, others, suppressed } = foldKpiGroups(all, minGroupSize);
  return {
    groups: others ? [...shown, others] : shown,
    // The total would give a hidden group away by subtraction.
    total: suppressed === 0 && total.people >= minGroupSize ? total : null,
    suppressed,
    minGroupSize,
  };
}

// ------------------------------------------------------------------- buckets

const mean = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length
    ? present.reduce((a, b) => a + b, 0) / present.length
    : null;
};

/**
 * The people of each completion bucket (20-point slices of the share of
 * goals completed) with the mean of each indicator and of the positive share
 * of their comments. People without goals have no completion: they are only
 * counted in `withoutGoals`. With a minimum (direction) a bucket under it is
 * hidden and its people counted in `suppressed`; an empty bucket gives
 * nobody away and stays; `withoutGoals` is not shown to direction.
 */
export function bucketRows(
  rows: readonly GoalIndicatorRow[],
  minGroupSize: number | null,
): { buckets: GoalBucket[]; withoutGoals: number | null; suppressed: number } {
  const slices: GoalIndicatorRow[][] = buckets.map(() => []);
  for (const r of rows) {
    if (r.goals > 0) slices[bucketOf(r.completed, r.goals)].push(r);
  }
  let suppressed = 0;
  const result = buckets.map((range, i): GoalBucket => {
    const people = slices[i];
    if (
      minGroupSize !== null &&
      people.length > 0 &&
      people.length < minGroupSize
    ) {
      suppressed += people.length;
      return {
        ...range,
        people: null,
        meanRetention: null,
        meanEngagement: null,
        meanPositiveShare: null,
        hidden: true,
      };
    }
    return {
      ...range,
      people: people.length,
      meanRetention: mean(people.map((p) => p.retention)),
      meanEngagement: mean(people.map((p) => p.engagement)),
      meanPositiveShare: mean(people.map((p) => p.positiveShare)),
      hidden: false,
    };
  });
  return {
    buckets: result,
    withoutGoals:
      minGroupSize === null ? rows.filter((r) => r.goals === 0).length : null,
    suppressed,
  };
}

// ------------------------------------------------------------------ outliers

/** The thresholds of the outliers: the risk threshold is a setting, the rest fixed. */
export function outlierThresholds(
  riskThreshold: number,
  override: Partial<GoalOutlierThresholds> = {},
): GoalOutlierThresholds {
  return {
    goalsHigh: GOALS_HIGH_PCT,
    goalsLow: GOALS_LOW_PCT,
    riskThreshold,
    indicatorHigh: HIGH_INDICATOR,
    ...override,
  };
}

const outlier = (r: GoalIndicatorRow): GoalOutlier => ({
  participantId: r.participantId,
  personId: r.personId,
  name: r.name,
  managerId: r.managerId,
  managerName: r.managerName,
  department: r.department,
  goals: r.goals,
  completed: r.completed,
  completedPct: r.completedPct ?? 0,
  retention: r.retention,
  engagement: r.engagement,
});

const lowest = (p: GoalOutlier) =>
  Math.min(p.retention ?? Infinity, p.engagement ?? Infinity);

/**
 * People whose goals and indicators disagree:
 * - `doneButLow`: goals completed (share >= `goalsHigh`) but retention or
 *   engagement at or under the risk threshold, the lowest indicator first;
 * - `behindButHigh`: goals behind (share <= `goalsLow`) but both indicators
 *   answered and at or above `indicatorHigh`, the lowest share first.
 * People without goals or without the answers are never outliers. The shares
 * are compared with whole numbers (3 of 10 goals is exactly 30 %). With a
 * minimum (direction) only the count is given, and only when it reaches it.
 */
export function outlierRows(
  rows: readonly GoalIndicatorRow[],
  thresholds: GoalOutlierThresholds,
  minGroupSize: number | null,
): { doneButLow: OutlierGroup; behindButHigh: OutlierGroup } {
  const withGoals = rows.filter((r) => r.goals > 0);
  const doneButLow = withGoals
    .filter(
      (r) =>
        r.completed * 100 >= thresholds.goalsHigh * r.goals &&
        ((r.retention !== null && r.retention <= thresholds.riskThreshold) ||
          (r.engagement !== null && r.engagement <= thresholds.riskThreshold)),
    )
    .map(outlier)
    .sort(
      (a, b) =>
        b.completedPct - a.completedPct ||
        lowest(a) - lowest(b) ||
        collator(a.name, b.name),
    );
  const behindButHigh = withGoals
    .filter(
      (r) =>
        r.completed * 100 <= thresholds.goalsLow * r.goals &&
        r.retention !== null &&
        r.engagement !== null &&
        r.retention >= thresholds.indicatorHigh &&
        r.engagement >= thresholds.indicatorHigh,
    )
    .map(outlier)
    .sort(
      (a, b) => a.completedPct - b.completedPct || collator(a.name, b.name),
    );
  const group = (people: GoalOutlier[]): OutlierGroup =>
    minGroupSize === null
      ? { count: people.length, people }
      : {
          count: people.length >= minGroupSize ? people.length : null,
          people: [],
        };
  return { doneButLow: group(doneButLow), behindButHigh: group(behindButHigh) };
}
