import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { getSetting } from "@/modules/settings/service";
import { participantRows } from "./rows";
import { reachOf } from "./scope";
import {
  GOALS_HIGH_PCT,
  GOALS_LOW_PCT,
  type GoalIndicatorRow,
  type GoalInsightsFilters,
  type GoalOutlier,
  type GoalOutlierThresholds,
  type GoalOutliers,
  HIGH_INDICATOR,
  type Hierarchy,
  type OutlierGroup,
} from "./types";

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
 * People whose goals and indicators disagree, in a cycle:
 * - `doneButLow`: goals completed (share >= `goalsHigh`, 80 % by default) but
 *   retention or engagement at or under the risk threshold (the
 *   `alerts.riskThreshold` setting), the lowest indicator first;
 * - `behindButHigh`: goals behind (share <= `goalsLow`, 30 %) but both
 *   indicators answered and at or above `indicatorHigh` (4), the lowest share
 *   first.
 * People without goals or without the answers are never outliers. The shares
 * are compared with whole numbers (3 of 10 goals is exactly 30 %).
 *
 * People: everything. A manager: their direct reports of the snapshot.
 * Direction: only how many there are, and only when that reaches the
 * `aggregation.minGroupSize`. An employee: forbidden.
 */
export async function goalOutliers(
  db: DbOrTx,
  actor: ActorContext,
  input: {
    cycleId: string;
    hierarchy?: Hierarchy;
    filters?: GoalInsightsFilters;
    /** Replaces some thresholds for this call. */
    thresholds?: Partial<GoalOutlierThresholds>;
  },
): Promise<GoalOutliers> {
  const reach = await reachOf(db, actor);
  const thresholds: GoalOutlierThresholds = {
    goalsHigh: GOALS_HIGH_PCT,
    goalsLow: GOALS_LOW_PCT,
    riskThreshold: await getSetting(db, "alerts.riskThreshold"),
    indicatorHigh: HIGH_INDICATOR,
    ...input.thresholds,
  };
  const rows = (
    await participantRows(db, reach, { ...input, sentiment: false })
  ).filter((r) => r.goals > 0);
  const doneButLow = rows
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
        a.name.localeCompare(b.name, "es"),
    );
  const behindButHigh = rows
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
      (a, b) =>
        a.completedPct - b.completedPct || a.name.localeCompare(b.name, "es"),
    );
  if (reach.kind !== "aggregatesOnly") {
    const group = (people: GoalOutlier[]): OutlierGroup => ({
      count: people.length,
      people,
    });
    return {
      cycleId: input.cycleId,
      thresholds,
      doneButLow: group(doneButLow),
      behindButHigh: group(behindButHigh),
      minGroupSize: null,
    };
  }
  const min = reach.minGroupSize;
  const counted = (people: GoalOutlier[]): OutlierGroup => ({
    count: people.length >= min ? people.length : null,
    people: [],
  });
  return {
    cycleId: input.cycleId,
    thresholds,
    doneButLow: counted(doneButLow),
    behindButHigh: counted(behindButHigh),
    minGroupSize: min,
  };
}
