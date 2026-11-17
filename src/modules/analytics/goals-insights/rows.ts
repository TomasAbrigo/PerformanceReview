import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import {
  indicatorContext,
  loadRows,
} from "@/modules/analytics/indicators/rows";
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
  labeled: number;
  positive: number;
};

/**
 * One row per participant the reach allows: the goals of the period next to
 * the indicators the manager gave and, with `sentiment`, the share of the
 * person's labeled comments that is positive. The same rows feed the
 * goals-vs-indicators aggregate and the outliers.
 *
 * - Retention and engagement: the indicator rows of the indicators module
 *   (`loadRows`): the answers (1-5) of the participant's submitted manager
 *   review to the question revisions with that role; with several reviewers
 *   the latest submitted review counts.
 * - Sentiment: the effective label (a human correction beats the machine's,
 *   stale labels are left out, see qualitative-analysis/effective) of every
 *   answer of a submitted review of the participant, self and manager's.
 */
export async function participantRows(
  db: DbOrTx,
  actor: ActorContext,
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
    with ${ctes}${sentiment}
    select b.participant_id, b.person_id, b.name, b.manager_id, b.manager_name,
           b.department, g.goals, g.completed, g.progress_sum,
           ${input.sentiment ? sql`coalesce(se.labeled, 0)::int` : sql`0`} as labeled,
           ${input.sentiment ? sql`coalesce(se.positive, 0)::int` : sql`0`} as positive
    from base b
    join g on g.participant_id = b.participant_id
    ${input.sentiment ? sql`left join sent se on se.participant_id = b.participant_id` : sql``}
    order by b.name, b.participant_id`);
  // The indicators module decides what the manager answered (and who may read it).
  const indicatorRows = await loadRows(db, await indicatorContext(db, actor), {
    cycleId: input.cycleId,
    hierarchy: "asOf",
  });
  const value = new Map(
    indicatorRows.map((r) => [`${r.participantId}:${r.indicator}`, r.value]),
  );
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
      retention: value.get(`${r.participant_id}:retention`) ?? null,
      engagement: value.get(`${r.participant_id}:engagement`) ?? null,
      positiveShare: r.labeled > 0 ? r.positive / r.labeled : null,
      labeledComments: r.labeled,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}
