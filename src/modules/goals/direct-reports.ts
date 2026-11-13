import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

export type DirectReport = { id: string; displayName: string };

/**
 * Who reports to `managerPersonId` today.
 *
 * TEMPORARY SEAM: until the org history (job history with a manager as-of
 * date) lands, the manager is read from `supervisorEId` in the employee
 * payload that produced each person's current employment. The org-history
 * module should replace the body of this function (the signature is the
 * contract); nothing else in goals depends on how reports are found.
 *
 * Only people currently employed count: a live (not deleted) latest
 * employment that is neither terminated nor Inactive.
 */
export async function listDirectReports(
  db: DbOrTx,
  managerPersonId: string,
): Promise<DirectReport[]> {
  const rows = await db.execute(sql`
    with latest as (
      select distinct on (e.person_id)
        e.person_id, e.source_system, e.source_id, e.payload_hash,
        e.status, e.termination_date
      from employment e
      where e.deleted_at is null
      order by e.person_id, e.hire_date desc nulls last
    )
    select p.id, p.display_name as "displayName"
    from latest l
    join raw_record r
      on r.source_system = l.source_system
     and r.entity = 'employee'
     and r.source_id = l.source_id
     and r.payload_hash = l.payload_hash
    join person p on p.id = l.person_id
    where (l.termination_date is null or l.termination_date > current_date)
      and lower(coalesce(l.status, '')) <> 'inactive'
      and r.payload ->> 'supervisorEId' in (
        select i.value
        from source_identity i
        where i.person_id = ${managerPersonId}
          and i.source_system = l.source_system
          and i.kind = 'bamboo_id'
          and i.valid_to is null
      )
    order by p.display_name, p.id
  `);
  return rows as unknown as DirectReport[];
}
