import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { loadRows } from "@/modules/analytics/indicators/rows";
import { effectiveCte } from "@/modules/qualitative-analysis/effective";
import { type GoalContext, goalCtes } from "./scope";
import type { GoalIndicatorRow, Hierarchy } from "./types";

type Raw = {
  participant_id: string;
  person_id: string;
  name: string;
  manager_id: string | null;
  manager_name: string | null;
  department: string | null;
  goals: number;
  completed: number;
  in_progress: number;
  closed: number;
  overdue: number;
  progress_sum: number;
  labeled: number;
  positive: number;
};

/**
 * One row per participant the reach allows, unfiltered: the goals of the
 * period next to the indicators the manager gave and, with `sentiment`, the
 * share of the person's labeled comments that is positive. Everything the
 * views show (KPIs, buckets, outliers, the filter options) is derived from
 * these rows (see derive.ts), so a page loads them once.
 *
 * - Retention and engagement: the indicator rows of the indicators module
 *   (`loadRows`): the answers (1-5) of the participant's submitted manager
 *   review to the question revisions with that role; with several reviewers
 *   the latest submitted review counts.
 * - Sentiment: the effective label (a human correction beats the machine's,
 *   stale labels are left out, see qualitative-analysis/effective) of every
 *   answer of a submitted self or manager review of the participant.
 *
 * Sorted by name (collator order), then by participant.
 */
export async function loadParticipantRows(
  db: DbOrTx,
  ctx: GoalContext,
  input: { hierarchy: Hierarchy; sentiment: boolean },
): Promise<GoalIndicatorRow[]> {
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
          and r.relationship in ('self', 'manager')
          and r.participant_id in (select participant_id from scoped)
        group by r.participant_id
      )`
    : sql``;
  const rows = await db.execute<Raw>(sql`
    with recursive ${goalCtes(ctx, input.hierarchy)}${sentiment}
    select b.participant_id, b.person_id, b.name, b.manager_id, b.manager_name,
           b.department, g.goals, g.completed, g.in_progress, g.closed,
           g.overdue, g.progress_sum,
           ${input.sentiment ? sql`coalesce(se.labeled, 0)::int` : sql`0`} as labeled,
           ${input.sentiment ? sql`coalesce(se.positive, 0)::int` : sql`0`} as positive
    from scoped b
    join g on g.participant_id = b.participant_id
    ${input.sentiment ? sql`left join sent se on se.participant_id = b.participant_id` : sql``}`);
  // The indicators module decides what the manager answered (and who may read it).
  const indicatorRows = await loadRows(db, ctx.indicators, {
    cycleId: ctx.cycleId,
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
      inProgress: r.in_progress,
      closed: r.closed,
      overdue: r.overdue,
      progressSum: r.progress_sum,
      completedPct: r.goals > 0 ? (r.completed / r.goals) * 100 : null,
      avgProgress: r.goals > 0 ? r.progress_sum / r.goals : null,
      retention: value.get(`${r.participant_id}:retention`) ?? null,
      engagement: value.get(`${r.participant_id}:engagement`) ?? null,
      positiveShare: r.labeled > 0 ? r.positive / r.labeled : null,
      labeledComments: r.labeled,
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "es") ||
        a.participantId.localeCompare(b.participantId),
    );
}
