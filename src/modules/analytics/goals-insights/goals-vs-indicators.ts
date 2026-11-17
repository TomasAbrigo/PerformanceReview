import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { participantRows } from "./rows";
import { reachOf } from "./scope";
import {
  bucketOf,
  buckets,
  type GoalBucket,
  type GoalInsightsFilters,
  type GoalsVsIndicators,
  type GoalIndicatorRow,
  type Hierarchy,
} from "./types";

const mean = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length
    ? present.reduce((a, b) => a + b, 0) / present.length
    : null;
};

/** The people of one completion bucket as a bucket of the aggregate. */
function bucketOfPeople(
  range: { from: number; to: number },
  people: GoalIndicatorRow[],
): GoalBucket {
  return {
    ...range,
    people: people.length,
    meanRetention: mean(people.map((p) => p.retention)),
    meanEngagement: mean(people.map((p) => p.engagement)),
    meanPositiveShare: mean(people.map((p) => p.positiveShare)),
    hidden: false,
  };
}

/**
 * The goals of a cycle against the assessment: per participant the goals
 * completed (share), the mean progress, retention, engagement and the share of
 * positive comments; and, per completion bucket (20-point slices of the share
 * of goals completed), how many people fall in it and the mean of each
 * indicator. People without goals have no completion: they only appear in
 * `rows` and in `withoutGoals`.
 *
 * People: everything. A manager: their direct reports of the snapshot.
 * Direction: only the buckets with at least the `aggregation.minGroupSize`
 * people (the others are hidden and counted in `suppressed`), no rows. An
 * employee: forbidden.
 */
export async function goalsVsIndicators(
  db: DbOrTx,
  actor: ActorContext,
  input: {
    cycleId: string;
    hierarchy?: Hierarchy;
    filters?: GoalInsightsFilters;
  },
): Promise<GoalsVsIndicators> {
  const reach = await reachOf(db, actor);
  const rows = await participantRows(db, reach, { ...input, sentiment: true });
  const slices: GoalIndicatorRow[][] = buckets.map(() => []);
  for (const r of rows) {
    if (r.goals > 0) slices[bucketOf(r.completed, r.goals)].push(r);
  }
  const all = buckets.map((range, i) => bucketOfPeople(range, slices[i]));
  const withoutGoals = rows.filter((r) => r.goals === 0).length;
  if (reach.kind !== "aggregatesOnly") {
    return {
      cycleId: input.cycleId,
      rows,
      buckets: all,
      withoutGoals,
      suppressed: 0,
      minGroupSize: null,
    };
  }
  const min = reach.minGroupSize;
  let suppressed = 0;
  const shown = all.map((b): GoalBucket => {
    // An empty bucket gives nobody away; a small one is hidden.
    if (b.people === 0 || (b.people ?? 0) >= min) return b;
    suppressed += b.people ?? 0;
    return {
      from: b.from,
      to: b.to,
      people: null,
      meanRetention: null,
      meanEngagement: null,
      meanPositiveShare: null,
      hidden: true,
    };
  });
  return {
    cycleId: input.cycleId,
    rows: [],
    buckets: shown,
    withoutGoals: null,
    suppressed,
    minGroupSize: min,
  };
}
