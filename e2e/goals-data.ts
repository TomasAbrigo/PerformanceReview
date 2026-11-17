import postgres from "postgres";
import { assertLocalDatabase } from "../src/db/local";
import { e2eDatabaseUrl } from "./database";

/** What the specs need to know of what the import left (read only). */
async function query<T extends object>(
  run: (sql: postgres.Sql) => Promise<T[]>,
): Promise<T[]> {
  const url = e2eDatabaseUrl();
  assertLocalDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/**
 * The participant row of `personName` in `cycleName`: its id, the cycle's,
 * and who managed them at the snapshot, if that manager has a name no other
 * person shares (the actor selector picks people by name).
 */
export async function participantOf(
  cycleName: string,
  personName: string,
): Promise<{
  cycleId: string;
  participantId: string;
  managerName: string | null;
}> {
  const [row] = await query<{
    cycle_id: string;
    participant_id: string;
    manager_name: string | null;
  }>(
    (sql) => sql`
      select c.id as cycle_id, cp.id as participant_id,
             (select m.display_name from person m
              where m.id = cp.snap_manager_person_id
                and (select count(*) from person p
                     where p.display_name = m.display_name) = 1) as manager_name
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.name = ${cycleName}
      join person r on r.id = cp.reviewee_person_id and r.display_name = ${personName}
      limit 1`,
  );
  if (!row) throw new Error(`${personName} is not in ${cycleName}`);
  return {
    cycleId: row.cycle_id,
    participantId: row.participant_id,
    managerName: row.manager_name,
  };
}

export type GoalTotals = {
  people: number;
  goals: number;
  completed: number;
  inProgress: number;
  overdue: number;
};

/**
 * The goal figures of the cycle worked out straight from the goal snapshot
 * the import leaves (one per participant, when the run finishes): what the
 * KPIs' total row must say. Overdue: in progress and due before the period
 * ended. Participants removed from the cycle and goals that no longer apply
 * do not count.
 */
export async function goalTotals(cycleName: string): Promise<GoalTotals> {
  const [row] = await query<GoalTotals>(
    (sql) => sql`
      select count(distinct cp.id)::int as people,
             count(g.id)::int as goals,
             count(g.id) filter (where g.status = 'completed')::int as completed,
             count(g.id) filter (where g.status = 'in_progress')::int as "inProgress",
             count(g.id) filter (
               where g.status = 'in_progress' and g.due_date < c.period_end
             )::int as overdue
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.name = ${cycleName}
      left join participant_goal_snapshot g
        on g.participant_id = cp.id and not g.no_longer_applicable
      where cp.removed_at is null and c.status <> 'draft'`,
  );
  return row;
}
