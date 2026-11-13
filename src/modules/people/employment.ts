import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { SourceSystem } from "@/db/schema";

/**
 * THE definition of "currently employed", for everything that needs it.
 *
 * A person's current employment is their latest live one: not soft-deleted,
 * the latest hire date (a rehire is a later period). The person is active when
 * that employment has not ended (no termination date, or one still ahead) and
 * its status is not Inactive. Older periods never make someone active.
 *
 * SQL fragment for a `WITH` list; defines `active_employment(person_id,
 * source_system, source_id, payload_hash)` with one row per active person.
 */
export const activeEmploymentCte = sql`
  active_employment as (
    select person_id, source_system, source_id, payload_hash
    from (
      select distinct on (e.person_id)
        e.person_id, e.source_system, e.source_id, e.payload_hash,
        e.status, e.termination_date
      from employment e
      where e.deleted_at is null
      order by e.person_id, e.hire_date desc nulls last, e.id
    ) latest
    where (latest.termination_date is null or latest.termination_date > current_date)
      and lower(coalesce(latest.status, '')) <> 'inactive'
  )
`;

/** Bamboo ids of the employees that are active today in `source`, ascending. */
export async function listActiveEmployeeIds(
  db: DbOrTx,
  source: SourceSystem,
): Promise<string[]> {
  const rows = await db.execute(sql`
    with ${activeEmploymentCte}
    select distinct source_id as "employeeId"
    from active_employment
    where source_system = ${source} and source_id is not null
    order by source_id
  `);
  return (rows as unknown as { employeeId: string }[]).map((r) => r.employeeId);
}
