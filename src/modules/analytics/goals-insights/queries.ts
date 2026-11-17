import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import type { IndicatorConfig } from "@/modules/analytics/indicators/types";
import { ReviewError } from "@/modules/review-core/review-errors";
import {
  bucketRows,
  filterOptionsOf,
  filterRows,
  kpisOf,
  outlierRows,
  outlierThresholds,
} from "./derive";
import { loadParticipantRows } from "./rows";
import { type GoalContext, goalContext } from "./scope";
import type {
  GoalGroupBy,
  GoalInsightsFilterOptions,
  GoalInsightsFilters,
  GoalKpis,
  GoalOutlierThresholds,
  GoalOutliers,
  GoalsVsIndicators,
  Hierarchy,
} from "./types";

/** What every query takes: the cycle, how to read the org, the filters. */
export type GoalInsightsInput = {
  cycleId: string;
  hierarchy?: Hierarchy;
  filters?: GoalInsightsFilters;
  /**
   * Replaces settings for this call, as the indicators' `config` does: the
   * minimum group size direction is masked with (the Arturía export applies
   * its own) and the risk threshold of the outliers.
   */
  config?: Partial<IndicatorConfig>;
};

/** The minimum group size of direction; null for readers that see everything. */
const minOf = (ctx: GoalContext) =>
  ctx.reach.kind === "aggregatesOnly" ? ctx.reach.minGroupSize : null;

/** Direction never reads a person: its grouping is the area or the manager. */
function requireGroupable(ctx: GoalContext, groupBy: GoalGroupBy) {
  if (ctx.reach.kind === "aggregatesOnly" && groupBy === "person") {
    throw new ReviewError("forbidden");
  }
}

function kpisView(
  ctx: GoalContext,
  hierarchy: Hierarchy,
  groupBy: GoalGroupBy,
  rows: Parameters<typeof kpisOf>[0],
): GoalKpis {
  return {
    cycleId: ctx.cycleId,
    groupBy,
    hierarchy,
    ...kpisOf(rows, groupBy, minOf(ctx)),
  };
}

function vsView(
  ctx: GoalContext,
  rows: Parameters<typeof bucketRows>[0],
): GoalsVsIndicators {
  const min = minOf(ctx);
  return {
    cycleId: ctx.cycleId,
    // Direction gets aggregates only, no person.
    rows: min === null ? [...rows] : [],
    ...bucketRows(rows, min),
    minGroupSize: min,
  };
}

function outliersView(
  ctx: GoalContext,
  rows: Parameters<typeof outlierRows>[0],
  override?: Partial<GoalOutlierThresholds>,
): GoalOutliers {
  const thresholds = outlierThresholds(
    ctx.indicators.config.riskThreshold,
    override,
  );
  return {
    cycleId: ctx.cycleId,
    thresholds,
    ...outlierRows(rows, thresholds, minOf(ctx)),
    minGroupSize: minOf(ctx),
  };
}

/**
 * Goal indicators of a cycle per person, manager or area: how many goals the
 * group's people had in the period (the cycle's goal snapshot), the share that
 * is completed, in progress and overdue (in progress and due before the period
 * ended; a closed goal never is) and the mean progress. The manager and the
 * area are the snapshot's, or today's with `hierarchy: "current"`.
 *
 * People: everything. A manager: their direct reports of the snapshot.
 * Direction: only areas and teams with at least the
 * `aggregation.minGroupSize` people (smaller ones are folded into "Otros",
 * hidden when that is still under it), never a person; a team keeps its
 * `key` but has no `label` (a manager is a person, so no name). An employee:
 * forbidden.
 */
export async function goalKpis(
  db: DbOrTx,
  actor: ActorContext,
  input: GoalInsightsInput & { groupBy: GoalGroupBy },
): Promise<GoalKpis> {
  const ctx = await goalContext(db, actor, input.cycleId, input.config);
  requireGroupable(ctx, input.groupBy);
  const hierarchy = input.hierarchy ?? "asOf";
  const all = await loadParticipantRows(db, ctx, {
    hierarchy,
    sentiment: false,
  });
  return kpisView(
    ctx,
    hierarchy,
    input.groupBy,
    filterRows(all, input.filters),
  );
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
  input: GoalInsightsInput,
): Promise<GoalsVsIndicators> {
  const ctx = await goalContext(db, actor, input.cycleId, input.config);
  const all = await loadParticipantRows(db, ctx, {
    hierarchy: input.hierarchy ?? "asOf",
    sentiment: true,
  });
  return vsView(ctx, filterRows(all, input.filters));
}

/**
 * People whose goals and indicators disagree, in a cycle (see `outlierRows`):
 * goals done but retention or engagement at or under the risk threshold (the
 * `alerts.riskThreshold` setting), and goals behind but both indicators high.
 *
 * People: everything. A manager: their direct reports of the snapshot.
 * Direction: only how many there are, and only when that reaches the
 * `aggregation.minGroupSize`. An employee: forbidden.
 */
export async function goalOutliers(
  db: DbOrTx,
  actor: ActorContext,
  input: GoalInsightsInput & {
    /** Replaces some thresholds for this call. */
    thresholds?: Partial<GoalOutlierThresholds>;
  },
): Promise<GoalOutliers> {
  const ctx = await goalContext(db, actor, input.cycleId, input.config);
  const all = await loadParticipantRows(db, ctx, {
    hierarchy: input.hierarchy ?? "asOf",
    sentiment: false,
  });
  return outliersView(ctx, filterRows(all, input.filters), input.thresholds);
}

/**
 * Values for the filter selects: the areas (and managers) of the participants
 * the actor reads. Direction gets the areas only: it never sees a person.
 */
export async function goalInsightsFilterOptions(
  db: DbOrTx,
  actor: ActorContext,
  input: { cycleId: string; hierarchy?: Hierarchy },
): Promise<GoalInsightsFilterOptions> {
  const ctx = await goalContext(db, actor, input.cycleId);
  const all = await loadParticipantRows(db, ctx, {
    hierarchy: input.hierarchy ?? "asOf",
    sentiment: false,
  });
  return filterOptionsOf(all, minOf(ctx) === null);
}

/**
 * Everything `/insights/goals` shows, from one load of the participant rows:
 * the authorization, the cycle and the settings are read once, and the KPIs,
 * the goals-vs-indicators aggregate, the outliers and the filter options are
 * all derived from the same rows (the options from the unfiltered ones).
 * `groupBys` asks for more groupings of the KPIs off the same rows (the
 * Arturía export wants areas and teams); `kpisBy` has them all, `groupBy`'s
 * included, and `kpis` is the one of `groupBy`.
 */
export async function goalInsights(
  db: DbOrTx,
  actor: ActorContext,
  input: GoalInsightsInput & {
    groupBy: GoalGroupBy;
    groupBys?: readonly GoalGroupBy[];
  },
): Promise<{
  kpis: GoalKpis;
  kpisBy: Partial<Record<GoalGroupBy, GoalKpis>>;
  vsIndicators: GoalsVsIndicators;
  outliers: GoalOutliers;
  options: GoalInsightsFilterOptions;
}> {
  const ctx = await goalContext(db, actor, input.cycleId, input.config);
  const groupBys = [...new Set([input.groupBy, ...(input.groupBys ?? [])])];
  for (const g of groupBys) requireGroupable(ctx, g);
  const hierarchy = input.hierarchy ?? "asOf";
  const all = await loadParticipantRows(db, ctx, {
    hierarchy,
    sentiment: true,
  });
  const rows = filterRows(all, input.filters);
  const kpisBy = Object.fromEntries(
    groupBys.map((g) => [g, kpisView(ctx, hierarchy, g, rows)]),
  ) as Record<GoalGroupBy, GoalKpis>;
  return {
    kpis: kpisBy[input.groupBy],
    kpisBy,
    vsIndicators: vsView(ctx, rows),
    outliers: outliersView(ctx, rows),
    options: filterOptionsOf(all, minOf(ctx) === null),
  };
}
