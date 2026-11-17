import postgres from "postgres";
import { assertLocalDatabase } from "../src/db/local";
import { e2eDatabaseUrl } from "./database";

/**
 * Reads what the import left: a person who is the snapshot manager of someone
 * with retention or engagement in `cycleName`, with a name no other person
 * shares (the actor selector picks people by name).
 */
export async function snapshotManagerWithIndicators(
  cycleName: string,
): Promise<{ name: string; reports: number }> {
  const url = e2eDatabaseUrl();
  assertLocalDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ name: string; reports: number }[]>`
      select m.display_name as name, count(distinct cp.id)::int as reports
      from cycle_participant cp
      join review_cycle c on c.id = cp.cycle_id and c.name = ${cycleName}
      join person m on m.id = cp.snap_manager_person_id
      join review_request r on r.participant_id = cp.id
        and r.relationship = 'manager' and r.status = 'submitted'
      join answer a on a.request_id = r.id
      join question_revision q on q.id = a.question_revision_id
        and q.role in ('retention', 'engagement')
      where cp.removed_at is null and a.option_value between 1 and 5
        and (select count(*) from person p where p.display_name = m.display_name) = 1
      group by m.display_name
      order by reports desc, m.display_name
      limit 1`;
    if (!rows[0]) throw new Error("no snapshot manager with indicators");
    return rows[0];
  } finally {
    await sql.end();
  }
}
