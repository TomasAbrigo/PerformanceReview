import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { effectiveCte } from "@/modules/qualitative-analysis/effective";
import { goalCtes, type Reach, requireCycle } from "./scope";
import type { GoalIndicatorRow, GoalInsightsFilters, Hierarchy } from "./types";

type Raw = {
  participant_id: string;
  person_id: string;
  name: string;
  manager_id: string | null;
  manager_name: string | null;
  department: string | null;
  goals: number;
  completed: number;
  progress_sum: number;
  retention: number | null;
  engagement: number | null;
  labeled: number;
  positive: number;
};

/**
 * One row per participant the reach allows: the goals of the period next to
 * the indicators the manager gave and, with `sentiment`, the share of the
 * person's labeled comments that is positive. The same rows feed the
 * goals-vs-indicators aggregate and the outliers.
 *
 * - Retention and engagement: the answers (1-5) of the participant's
 *   submitted manager review to the question revisions with that role; with
 *   several reviewers the latest submitted review counts.
 * - Sentiment: the effective label (a human correction beats the machine's,
 *   stale labels are left out, see qualitative-analysis/effective) of every
 *   answer of a submitted review of the participant, self and manager's.
 */
export async function participantRows(
  db: DbOrTx,
  reach: Reach,
  input: {
    cycleId: string;
    hierarchy?: Hierarchy;
    filters?: GoalInsightsFilters;
    sentiment: boolean;
  },
): Promise<GoalIndicatorRow[]> {
  await requireCycle(db, input.cycleId);
  const ctes = goalCtes(reach, {
    cycleId: input.cycleId,
    hierarchy: input.hierarchy ?? "asOf",
    filters: input.filters,
  });
  const sentiment = input.sentiment
    ? sql`,
      ${effectiveCte()},
      sent as (
        select r.participant_id, count(*)::int as labeled,
               count(*) filter (where e.sentiment = 'positive')::int as positive
        from eff e
        join answer a on a.id = e.answer_id
        join review_request r on r.id = a.request_id
        where r.status = 'submitted' and r.deleted_at is null
          and r.participant_id in (select participant_id from base)
        group by r.participant_id
      )`
    : sql``;
  const rows = await db.execute<Raw>(sql`
    with ${ctes},
    ind as (
      select distinct on (b.participant_id, q.role)
             b.participant_id, q.role as indicator, a.option_value::int as value
      from base b
      join review_request r on r.participant_id = b.participant_id
        and r.relationship = 'manager' and r.status = 'submitted'
        and r.deleted_at is null
      join question_revision q on q.cycle_id = b.cycle_id
        and q.role in ('retention', 'engagement')
      join answer a on a.request_id = r.id and a.question_revision_id = q.id
        and a.option_value in (1, 2, 3, 4, 5)
      order by b.participant_id, q.role, r.submitted_at desc nulls last, r.id
    )${sentiment}
    select b.participant_id, b.person_id, b.name, b.manager_id, b.manager_name,
           b.department, g.goals, g.completed, g.progress_sum,
           ret.value as retention, eng.value as engagement,
           ${input.sentiment ? sql`coalesce(se.labeled, 0)::int` : sql`0`} as labeled,
           ${input.sentiment ? sql`coalesce(se.positive, 0)::int` : sql`0`} as positive
    from base b
    join g on g.participant_id = b.participant_id
    left join ind ret on ret.participant_id = b.participant_id and ret.indicator = 'retention'
    left join ind eng on eng.participant_id = b.participant_id and eng.indicator = 'engagement'
    ${input.sentiment ? sql`left join sent se on se.participant_id = b.participant_id` : sql``}
    order by b.name, b.participant_id`);
  return rows
    .map((r) => ({
      participantId: r.participant_id,
      personId: r.person_id,
      name: r.name,
      managerId: r.manager_id,
      managerName: r.manager_name,
      department: r.department,
      goals: r.goals,
      completed: r.completed,
      completedPct: r.goals > 0 ? (r.completed / r.goals) * 100 : null,
      avgProgress: r.goals > 0 ? r.progress_sum / r.goals : null,
      retention: r.retention,
      engagement: r.engagement,
      positiveShare: r.labeled > 0 ? r.positive / r.labeled : null,
      labeledComments: r.labeled,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
