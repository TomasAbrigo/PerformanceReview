import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import {
  completionCycles,
  completionSummary,
} from "@/modules/analytics/completion";
import { ALL_PEOPLE, scopedCtes } from "@/modules/analytics/dashboards/scope";
import { goalKpis } from "@/modules/analytics/goals-insights/queries";
import { indicatorSnapshot } from "@/modules/analytics/indicators/queries";
import type { IndicatorDistribution } from "@/modules/analytics/indicators/types";
import { insightsScope } from "@/modules/insights/authz";
import type { OrgFilters } from "@/modules/org-attributes/kinds";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import type { MeanOf, PeriodDetail, PeriodDetailRow } from "./types";

export type PeriodDetailFilters = OrgFilters & {
  department?: string;
  managerId?: string;
  /** Direction's minimum group size; default: the `aggregation.minGroupSize` setting. */
  minGroupSize?: number;
};

const fromDistribution = (d: IndicatorDistribution): MeanOf | null =>
  d.total && d.total.mean !== null
    ? { n: d.total.n, mean: d.total.mean }
    : null;

/**
 * Mean of the self "valued" answer (1-4) of a cycle's participants in scope:
 * the latest submitted self review's answer to the question of the role
 * `valued` (the lowest `sort` if the template has several). `runAs` is who
 * `scopedCtes` restricts to (direction is computed over everybody and masked
 * by the caller).
 */
async function valuedMean(
  db: DbOrTx,
  runAs: ActorContext,
  cycleId: string,
  filters: PeriodDetailFilters,
): Promise<MeanOf | null> {
  const [row] = await db.execute<{ n: number; mean: number | null }>(sql`
    with recursive ${scopedCtes(
      runAs,
      {
        cycleId,
        hierarchy: "asOf",
        department: filters.department,
        managerId: filters.managerId,
        account: filters.account,
        project: filters.project,
        dm: filters.dm,
        santexLead: filters.santexLead,
      },
      { snapshotScope: true },
    )},
    v as (
      select distinct on (s.participant_id) s.participant_id,
             a.option_value::int as value
      from scoped s
      join review_request r on r.participant_id = s.participant_id
        and r.relationship = 'self' and r.status = 'submitted'
        and r.deleted_at is null
      join question_revision q on q.cycle_id = s.cycle_id and q.role = 'valued'
      join answer a on a.request_id = r.id and a.question_revision_id = q.id
        and a.option_value in (1, 2, 3, 4)
      order by s.participant_id, r.submitted_at desc nulls last, r.id,
               q.sort, q.created_at, q.id
    )
    select count(*)::int as n, avg(value)::float8 as mean from v`);
  return row && row.n > 0 && row.mean !== null
    ? { n: row.n, mean: row.mean }
    : null;
}

/**
 * The "Detalle por período": one row per launched cycle, oldest first, with
 * its head count, self and manager completion, the mean of the valued
 * (self, 1-4), retention and engagement (manager, 1-5) answers and the share
 * of goals completed. People read everything (and may cut it by area,
 * manager and the org attributes), a manager their direct reports of each
 * cycle's snapshot, direction aggregates: no filters, and every figure of a
 * cycle with fewer people than `aggregation.minGroupSize` hidden (the head
 * count stays). Employees are forbidden.
 */
export async function periodDetail(
  db: DbOrTx,
  actor: ActorContext,
  f: PeriodDetailFilters = {},
): Promise<PeriodDetail> {
  const first = insightsScope(actor);
  if (first.kind === "none") throw new ReviewError("forbidden");
  const masked = first.kind === "aggregatesOnly";
  const minGroupSize = masked
    ? (f.minGroupSize ?? (await getSetting(db, "aggregation.minGroupSize")))
    : undefined;
  // Direction reads whole cycles, as its completion and executive views do.
  const filters: PeriodDetailFilters = masked
    ? {}
    : {
        department: f.department,
        managerId: f.managerId,
        account: f.account,
        project: f.project,
        dm: f.dm,
        santexLead: f.santexLead,
      };
  const cycles = (await completionCycles(db)).reverse();
  const rows = await Promise.all(
    cycles.map(async (cycle): Promise<PeriodDetailRow> => {
      const [completion, snapshot, goals, valued] = await Promise.all([
        completionSummary(db, actor, {
          cycleId: cycle.id,
          groupBy: "none",
          ...filters,
          minGroupSize,
        }),
        indicatorSnapshot(db, actor, {
          cycleId: cycle.id,
          config: minGroupSize === undefined ? undefined : { minGroupSize },
          filters,
        }),
        goalKpis(db, actor, {
          cycleId: cycle.id,
          groupBy: "department",
          config: minGroupSize === undefined ? undefined : { minGroupSize },
          filters,
        }),
        valuedMean(db, masked ? ALL_PEOPLE : actor, cycle.id, filters),
      ]);
      return {
        cycleId: cycle.id,
        cycleName: cycle.name,
        localizedName: cycle.localizedName,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        participants: completion.participants,
        selfRate: completion.total?.selfRate ?? null,
        managerRate: completion.total?.managerRate ?? null,
        valued:
          valued && (minGroupSize === undefined || valued.n >= minGroupSize)
            ? valued
            : null,
        retention: fromDistribution(snapshot.retention),
        engagement: fromDistribution(snapshot.engagement),
        // Against the target: the goals that were due by the cycle's reference
        // date (a goal not due yet is not a failure), and how many were.
        goalsCompletedPct: goals.total?.completedDuePct ?? null,
        goals: goals.total ? goals.total.due : null,
      };
    }),
  );
  return { rows, minGroupSize: minGroupSize ?? null };
}
