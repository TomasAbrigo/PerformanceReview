import { asc, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { person } from "@/db/schema";
import { jobValidOn, rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";

export type ActorOption = { id: string; displayName: string };

/** Lightweight list for the "act as" selector (id + name only). */
export function listActorOptions(db: DbOrTx): Promise<ActorOption[]> {
  return db
    .select({ id: person.id, displayName: person.displayName })
    .from(person)
    .orderBy(asc(person.displayName));
}

export async function personExists(
  db: DbOrTx,
  personId: string,
): Promise<boolean> {
  if (!isUuid(personId)) return false;
  const [row] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.id, personId));
  return !!row;
}

export type ActorExamples = {
  manager: ActorOption | null;
  employee: ActorOption | null;
};

/**
 * Ready-made people to act as, so every flow can be seen in one click: the
 * manager whose current team has the most goals, and the member of that team
 * with the most goals and cycle participations.
 */
export async function listActorExamples(db: DbOrTx): Promise<ActorExamples> {
  const rows = rowsOf<{ kind: "manager" | "employee" } & ActorOption>(
    await db.execute(sql`
      with job as (
        select h.person_id, h.manager_person_id
        from employee_job_history h
        where ${jobValidOn("h")} and h.manager_person_id is not null
      ),
      goals as (
        select person_id, count(*) as n from goal group by person_id
      ),
      mgr as (
        select j.manager_person_id as id
        from job j left join goals g on g.person_id = j.person_id
        group by j.manager_person_id
        order by coalesce(sum(g.n), 0) desc, count(*) desc, j.manager_person_id
        limit 1
      ),
      emp as (
        select j.person_id as id
        from job j
        join mgr on mgr.id = j.manager_person_id
        left join goals g on g.person_id = j.person_id
        order by coalesce(g.n, 0) desc,
          (select count(*) from cycle_participant cp
           where cp.reviewee_person_id = j.person_id) desc,
          j.person_id
        limit 1
      )
      select 'manager' as kind, p.id, p.display_name as "displayName"
      from mgr join person p on p.id = mgr.id
      union all
      select 'employee', p.id, p.display_name
      from emp join person p on p.id = emp.id`),
  );
  const pick = (kind: "manager" | "employee"): ActorOption | null => {
    const row = rows.find((r) => r.kind === kind);
    return row ? { id: row.id, displayName: row.displayName } : null;
  };
  return { manager: pick("manager"), employee: pick("employee") };
}
