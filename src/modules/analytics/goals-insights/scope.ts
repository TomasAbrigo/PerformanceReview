import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { ALL_PEOPLE, scopedCtes } from "@/modules/analytics/dashboards/scope";
import {
  type IndicatorContext,
  indicatorContext,
  requireCycle,
} from "@/modules/analytics/indicators/rows";
import type { IndicatorConfig } from "@/modules/analytics/indicators/types";
import type { Hierarchy } from "./types";

/**
 * What an actor reads of the goals insights, decided by `insightsScope`:
 * People everything; a manager their direct reports of the cycle snapshot
 * (never themself); direction only aggregates of groups of at least the
 * minimum; everybody else (employees, also about themselves) is forbidden.
 */
export type Reach = IndicatorContext["scope"];

/**
 * What one request needs to know once: who reads, how far, the thresholds
 * (the indicators' context: one read of the settings) and that the cycle
 * exists. Every query and page builds it once and hands it down.
 */
export type GoalContext = {
  actor: ActorContext;
  reach: Reach;
  indicators: IndicatorContext;
  cycleId: string;
};

/**
 * Authorizes the actor (`forbidden`) and checks the cycle (`not_found`).
 * `config` replaces settings for this call (the indicators' override: the
 * minimum group size of direction, the risk threshold).
 */
export async function goalContext(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  config?: Partial<IndicatorConfig>,
): Promise<GoalContext> {
  const indicators = await indicatorContext(db, actor, config);
  await requireCycle(db, cycleId);
  return { actor, reach: indicators.scope, indicators, cycleId };
}

/**
 * CTEs of the goals of a cycle's participants, to be put after `with`:
 * - `cur` and `scoped`: the dashboards' participant scope (`scopedCtes`:
 *   launched, not deleted cycles, active participants, the org dimensions of
 *   the hierarchy) narrowed to the actor's reach, which for a manager is
 *   always their direct reports of the snapshot (never themself), whatever
 *   hierarchy the view reads. Direction is computed over everybody (it was
 *   authorized) and masked by the callers;
 * - `g`: per participant the figures of the goals of the period (the cycle's
 *   goal snapshot, `no_longer_applicable` ones left out): total, completed,
 *   in progress, closed, overdue (in progress and due before the period
 *   ended) and the sum of their percent complete.
 */
export function goalCtes(ctx: GoalContext, hierarchy: Hierarchy): SQL {
  const runAs = ctx.reach.kind === "aggregatesOnly" ? ALL_PEOPLE : ctx.actor;
  return sql`
    ${scopedCtes(
      runAs,
      { cycleId: ctx.cycleId, hierarchy },
      { snapshotScope: true },
    )},
    g as (
      select b.participant_id,
             count(s.id)::int as goals,
             count(s.id) filter (where s.status = 'completed')::int as completed,
             count(s.id) filter (where s.status = 'in_progress')::int as in_progress,
             count(s.id) filter (where s.status = 'closed')::int as closed,
             count(s.id) filter (
               where s.status = 'in_progress' and s.due_date < b.period_end::date
             )::int as overdue,
             coalesce(sum(s.percent_complete), 0)::int as progress_sum
      from scoped b
      left join participant_goal_snapshot s
        on s.participant_id = b.participant_id and not s.no_longer_applicable
      group by b.participant_id, b.period_end
    )`;
}
