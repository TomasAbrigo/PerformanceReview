import { type SQL, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { insightsScope } from "@/modules/insights/authz";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import type { GoalInsightsFilters, Hierarchy } from "./types";

/**
 * What an actor reads of the goals insights, decided once per call by
 * `insightsScope`: People everything; a manager their direct reports of the
 * cycle snapshot (never themself); direction only aggregates of groups of at
 * least the minimum; everybody else (employees, also about themselves) nothing.
 */
export type Reach =
  | { kind: "all" }
  | { kind: "directReports"; managerPersonId: string }
  | { kind: "aggregatesOnly"; minGroupSize: number };

/** The reach of an actor; `forbidden` when it is none. */
export async function reachOf(db: DbOrTx, actor: ActorContext): Promise<Reach> {
  const scope = insightsScope(actor);
  if (scope.kind === "none") throw new ReviewError("forbidden");
  if (scope.kind !== "aggregatesOnly") return scope;
  // The minimum is a setting that only matters to direction.
  const masked = insightsScope(
    actor,
    await getSetting(db, "aggregation.minGroupSize"),
  );
  if (masked.kind !== "aggregatesOnly") throw new ReviewError("forbidden");
  return masked;
}

const requireUuid = (id: string): string => {
  if (!isUuid(id)) throw new ReviewError("not_found");
  return id;
};

/** The cycle must exist (and be an id): `not_found` otherwise. */
export async function requireCycle(
  db: DbOrTx,
  cycleId: string,
): Promise<string> {
  requireUuid(cycleId);
  const found = await db.execute(
    sql`select 1 from review_cycle where id = ${cycleId}::uuid and deleted_at is null`,
  );
  if (found.length === 0) throw new ReviewError("not_found");
  return cycleId;
}

/**
 * CTEs of the goals of a cycle's participants, to be put after `with`:
 * - `cur`: the current job row of each person;
 * - `base`: the active participants of the cycle (launched, not removed) with
 *   their area and manager (the snapshot's, or today's), narrowed to the
 *   filters and to what the actor reads: a manager's reach is always their
 *   direct reports of the snapshot, whatever hierarchy the view reads;
 * - `g`: per participant the figures of the goals of the period (the cycle's
 *   goal snapshot, `no_longer_applicable` ones left out): total, completed,
 *   in progress, closed, overdue (in progress and due before the period
 *   ended) and the sum of their percent complete.
 */
export function goalCtes(
  reach: Reach,
  f: {
    cycleId: string;
    hierarchy: Hierarchy;
    filters?: GoalInsightsFilters;
  },
): SQL {
  const asOf = f.hierarchy === "asOf";
  const department = asOf ? sql`cp.snap_department` : sql`cur.department`;
  const manager = asOf
    ? sql`cp.snap_manager_person_id`
    : sql`cur.manager_person_id`;
  const where: SQL[] = [
    sql`cp.removed_at is null`,
    sql`c.status <> 'draft'`,
    sql`c.deleted_at is null`,
    sql`cp.cycle_id = ${requireUuid(f.cycleId)}::uuid`,
  ];
  if (f.filters?.department) {
    where.push(sql`${department} = ${f.filters.department}`);
  }
  if (f.filters?.managerId) {
    where.push(sql`${manager} = ${requireUuid(f.filters.managerId)}::uuid`);
  }
  if (reach.kind === "directReports") {
    where.push(sql`cp.snap_manager_person_id = ${reach.managerPersonId}::uuid`);
    // Never about themself, even if the data names them their own manager.
    where.push(sql`cp.reviewee_person_id <> ${reach.managerPersonId}::uuid`);
  }
  return sql`
    cur as (
      select distinct on (h.person_id) h.person_id, h.manager_person_id, h.department
      from employee_job_history h
      where h.deleted_at is null and h.valid_to is null
      order by h.person_id, h.valid_from desc
    ),
    base as (
      select cp.id as participant_id, cp.cycle_id, c.period_end,
             cp.reviewee_person_id as person_id, rp.display_name as name,
             ${department} as department, ${manager} as manager_id,
             mp.display_name as manager_name
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id
      join person rp on rp.id = cp.reviewee_person_id
      left join cur on cur.person_id = cp.reviewee_person_id
      left join person mp on mp.id = ${manager}
      where ${sql.join(where, sql` and `)}
    ),
    g as (
      select b.participant_id,
             count(s.id)::int as goals,
             count(s.id) filter (where s.status = 'completed')::int as completed,
             count(s.id) filter (where s.status = 'in_progress')::int as in_progress,
             count(s.id) filter (where s.status = 'closed')::int as closed,
             count(s.id) filter (
               where s.status = 'in_progress' and s.due_date < b.period_end
             )::int as overdue,
             coalesce(sum(s.percent_complete), 0)::int as progress_sum
      from base b
      left join participant_goal_snapshot s
        on s.participant_id = b.participant_id and not s.no_longer_applicable
      group by b.participant_id, b.period_end
    )`;
}
