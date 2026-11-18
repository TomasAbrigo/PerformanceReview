import postgres from "postgres";
import { assertLocalDatabase } from "../src/db/local";
import { e2eDatabaseUrl } from "./database";

/** What the goal-writing spec needs to know of what the import left. */
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

export type ReportingPair = {
  personId: string;
  personName: string;
  managerId: string;
  managerName: string;
};

/**
 * Someone and their manager today (the current job, not the cycle's
 * snapshot), both with a name nobody else has: an employee and the manager
 * who may write goals for them.
 */
export async function reportingPair(): Promise<ReportingPair | undefined> {
  const [row] = await query<ReportingPair>(
    (sql) => sql`
      select p.id as "personId", p.display_name as "personName",
             m.id as "managerId", m.display_name as "managerName"
      from employee_job_history h
      join person p on p.id = h.person_id
      join person m on m.id = h.manager_person_id
      where h.deleted_at is null and h.valid_from <= current_date
        and (h.valid_to is null or h.valid_to > current_date)
        and p.id <> m.id
        and (select count(*) from person x where x.display_name = p.display_name) = 1
        and (select count(*) from person x where x.display_name = m.display_name) = 1
      order by p.display_name limit 1`,
  );
  return row;
}

/** A goal row of the person by its title (what the spec just wrote). */
export async function goalRow(personId: string, title: string) {
  const [row] = await query<{
    id: string;
    status: string;
    percentComplete: number;
    sourceSystem: string;
    milestones: number;
  }>(
    (sql) => sql`
      select g.id, g.status, g.percent_complete as "percentComplete",
             g.source_system as "sourceSystem",
             (select count(*)::int from goal_milestone m
               where m.goal_id = g.id and m.deleted_at is null) as milestones
      from goal g
      where g.person_id = ${personId} and g.title = ${title}
        and g.deleted_at is null`,
  );
  return row;
}
