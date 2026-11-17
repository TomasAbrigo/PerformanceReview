import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { ReviewError } from "@/modules/review-core/review-errors";
import { foldKpiGroups, kpiGroup, sumGroups } from "./kpi";
import { goalCtes, reachOf, requireCycle } from "./scope";
import type {
  GoalGroupBy,
  GoalInsightsFilters,
  GoalKpiGroup,
  GoalKpis,
  Hierarchy,
} from "./types";

const groupColumns: Record<GoalGroupBy, { key: string; label: string }> = {
  person: { key: "b.person_id::text", label: "b.name" },
  manager: { key: "b.manager_id::text", label: "b.manager_name" },
  department: { key: "b.department", label: "b.department" },
};

/** Collator order of the labels, the unlabelled last. */
const byLabel = (a: GoalKpiGroup, b: GoalKpiGroup) =>
  a.label === null || b.label === null
    ? Number(a.label === null) - Number(b.label === null)
    : a.label.localeCompare(b.label, "es") ||
      (a.key ?? "").localeCompare(b.key ?? "");

/**
 * Goal indicators of a cycle per person, manager or area: how many goals the
 * group's people had in the period (the cycle's goal snapshot), the share that
 * is completed, in progress and overdue (in progress and due before the period
 * ended; a closed goal never is) and the mean progress. The manager and the
 * area are the snapshot's, or today's with `hierarchy: "current"`.
 *
 * People: everything. A manager: their direct reports of the snapshot.
 * Direction: only areas and managers with at least the
 * `aggregation.minGroupSize` people (smaller ones are folded into "Otros",
 * hidden when that is still under it), never a person. An employee: forbidden.
 */
export async function goalKpis(
  db: DbOrTx,
  actor: ActorContext,
  input: {
    cycleId: string;
    groupBy: GoalGroupBy;
    hierarchy?: Hierarchy;
    filters?: GoalInsightsFilters;
  },
): Promise<GoalKpis> {
  const reach = await reachOf(db, actor);
  if (reach.kind === "aggregatesOnly" && input.groupBy === "person") {
    throw new ReviewError("forbidden");
  }
  await requireCycle(db, input.cycleId);
  const hierarchy = input.hierarchy ?? "asOf";
  const col = groupColumns[input.groupBy];
  const rows = await db.execute<{
    key: string | null;
    label: string | null;
    people: number;
    people_with_goals: number;
    goals: number;
    completed: number;
    in_progress: number;
    closed: number;
    overdue: number;
    progress_sum: number;
  }>(sql`
    with ${goalCtes(reach, { cycleId: input.cycleId, hierarchy, filters: input.filters })}
    select ${sql.raw(col.key)} as key, ${sql.raw(col.label)} as label,
           count(*)::int as people,
           count(*) filter (where g.goals > 0)::int as people_with_goals,
           sum(g.goals)::int as goals, sum(g.completed)::int as completed,
           sum(g.in_progress)::int as in_progress, sum(g.closed)::int as closed,
           sum(g.overdue)::int as overdue, sum(g.progress_sum)::int as progress_sum
    from base b join g on g.participant_id = b.participant_id
    group by 1, 2`);
  const all = rows
    .map((r) =>
      kpiGroup({
        key: r.key,
        label: r.label,
        people: r.people,
        peopleWithGoals: r.people_with_goals,
        goals: r.goals,
        completed: r.completed,
        inProgress: r.in_progress,
        closed: r.closed,
        overdue: r.overdue,
        progressSum: r.progress_sum,
      }),
    )
    .sort(byLabel);
  const total = sumGroups(all, { key: null, label: null });
  const base = { cycleId: input.cycleId, groupBy: input.groupBy, hierarchy };
  if (reach.kind !== "aggregatesOnly") {
    return {
      ...base,
      groups: all,
      total,
      suppressed: 0,
      minGroupSize: null,
    };
  }
  const min = reach.minGroupSize;
  const { shown, others, suppressed } = foldKpiGroups(all, min);
  return {
    ...base,
    groups: others ? [...shown, others] : shown,
    // The total would give a hidden group away by subtraction.
    total: suppressed === 0 && total.people >= min ? total : null,
    suppressed,
    minGroupSize: min,
  };
}
