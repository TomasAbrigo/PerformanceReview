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
 * KPIs' total row must say. Overdue: in progress and due before today, the
 * app's one rule. Participants removed from the cycle and goals that no
 * longer apply do not count.
 */
export async function goalTotals(cycleName: string): Promise<GoalTotals> {
  const [row] = await query<GoalTotals>(
    (sql) => sql`
      select count(distinct cp.id)::int as people,
             count(g.id)::int as goals,
             count(g.id) filter (where g.status = 'completed')::int as completed,
             count(g.id) filter (where g.status = 'in_progress')::int as "inProgress",
             count(g.id) filter (
               where g.status = 'in_progress' and g.due_date < current_date
             )::int as overdue
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.name = ${cycleName}
      left join participant_goal_snapshot g
        on g.participant_id = cp.id and not g.no_longer_applicable
      where cp.removed_at is null and c.status <> 'draft'`,
  );
  return row;
}
