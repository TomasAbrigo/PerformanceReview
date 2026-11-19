// Pure and server-free: goal figures of a group, and the minimum-group-size
// rule for the views that only show aggregates (direction).
import type { GoalKpiGroup } from "./types";

/** What a group adds up to: counts of its people and goals. */
export type KpiCounts = {
  key: string | null;
  label: string | null;
  others?: boolean;
  people: number;
  peopleWithGoals: number;
  goals: number;
  completed: number;
  inProgress: number;
  closed: number;
  overdue: number;
  /** Sum of the goals' percent complete. */
  progressSum: number;
};

const share = (part: number, goals: number) =>
  goals > 0 ? (part / goals) * 100 : null;

/** The figures of a group from its counts (shares are of the group's goals). */
export function kpiGroup(c: KpiCounts): GoalKpiGroup {
  return {
    key: c.key,
    label: c.label,
    others: c.others ?? false,
    people: c.people,
    peopleWithGoals: c.peopleWithGoals,
    goals: c.goals,
    completed: c.completed,
    inProgress: c.inProgress,
    closed: c.closed,
    overdue: c.overdue,
    completedPct: share(c.completed, c.goals),
    inProgressPct: share(c.inProgress, c.goals),
    overduePct: share(c.overdue, c.goals),
    avgProgress: c.goals > 0 ? c.progressSum / c.goals : null,
  };
}

/**
 * Back from the figures to the counts: shares and means are derived. The sum
 * of progress is a whole number (each goal's percent complete is), so the
 * round trip through the mean is exact.
 */
const countsOf = (g: GoalKpiGroup): KpiCounts => ({
  key: g.key,
  label: g.label,
  people: g.people,
  peopleWithGoals: g.peopleWithGoals,
  goals: g.goals,
  completed: g.completed,
  inProgress: g.inProgress,
  closed: g.closed,
  overdue: g.overdue,
  progressSum: Math.round((g.avgProgress ?? 0) * g.goals),
});

/** The sum of groups as one group (shares recomputed from the sums). */
export function sumGroups(
  groups: readonly GoalKpiGroup[],
  as: Pick<KpiCounts, "key" | "label" | "others">,
): GoalKpiGroup {
  const total = groups.map(countsOf).reduce<KpiCounts>(
    (sum, c) => ({
      ...sum,
      people: sum.people + c.people,
      peopleWithGoals: sum.peopleWithGoals + c.peopleWithGoals,
      goals: sum.goals + c.goals,
      completed: sum.completed + c.completed,
      inProgress: sum.inProgress + c.inProgress,
      closed: sum.closed + c.closed,
      overdue: sum.overdue + c.overdue,
      progressSum: sum.progressSum + c.progressSum,
    }),
    {
      ...as,
      people: 0,
      peopleWithGoals: 0,
      goals: 0,
      completed: 0,
      inProgress: 0,
      closed: 0,
      overdue: 0,
      progressSum: 0,
    },
  );
  return kpiGroup(total);
}

export type FoldedKpiGroups = {
  /** Named groups with at least the minimum of people, as they came. */
  shown: GoalKpiGroup[];
  /** The rest together ("Otros"); null when empty or still under the minimum. */
  others: GoalKpiGroup | null;
  /** People left out of the breakdown altogether (Otros is under the minimum). */
  suppressed: number;
};

/** Whether a group is big enough to stand on its own (#130). */
const bigEnough = (g: GoalKpiGroup, min: number) =>
  g.people >= min &&
  // Its goal figures are those of the people who have goals: they need the
  // minimum too, unless nobody has any (then they say nothing about anyone).
  (g.peopleWithGoals === 0 || g.peopleWithGoals >= min);

/**
 * Groups under `minGroupSize` (people, and people with goals) and the unnamed
 * one are folded into one "Otros" cell; while that is still under the minimum
 * the smallest shown groups join it, so no group is hidden behind a public
 * total. Only a whole under the minimum is left out (its people counted).
 * With a minimum of 1 only the unnamed group is folded.
 */
export function foldKpiGroups(
  groups: readonly GoalKpiGroup[],
  minGroupSize: number,
): FoldedKpiGroups {
  const shown: GoalKpiGroup[] = [];
  const rest: GoalKpiGroup[] = [];
  for (const g of groups) {
    (g.key !== null && bigEnough(g, minGroupSize) ? shown : rest).push(g);
  }
  const small = (list: GoalKpiGroup[]) =>
    list.length > 0 &&
    !bigEnough(sumGroups(list, { key: null, label: null }), minGroupSize);
  while (small(rest) && shown.length) {
    const smallest = shown.reduce((a, b) =>
      b.peopleWithGoals < a.peopleWithGoals ||
      (b.peopleWithGoals === a.peopleWithGoals && b.people < a.people)
        ? b
        : a,
    );
    shown.splice(shown.indexOf(smallest), 1);
    rest.push(smallest);
  }
  const people = rest.reduce((n, g) => n + g.people, 0);
  if (people === 0) return { shown, others: null, suppressed: 0 };
  if (small(rest)) return { shown, others: null, suppressed: people };
  return {
    shown,
    others: sumGroups(rest, { key: null, label: null, others: true }),
    suppressed: 0,
  };
}
