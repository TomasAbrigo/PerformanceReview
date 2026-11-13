import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { activeEmploymentCte } from "@/modules/people/employment";

export type DirectReport = { id: string; displayName: string };

/**
 * TEMPORARY SEAM: who reports to whom today.
 *
 * Until the org history (job history with a manager as-of date) lands, the
 * supervisor is read from `supervisorEId` in the employee payload that
 * produced each person's current employment. The org-history module should
 * replace this fragment and the two functions below (their signatures are the
 * contract); nothing else in goals depends on how reports are found.
 *
 * `reports(report_id, source_system, supervisor_eid)`: people currently
 * employed (see `activeEmploymentCte`).
 */
const currentReports = sql`
  with ${activeEmploymentCte},
  reports as (
    select a.person_id as report_id, a.source_system,
      r.payload ->> 'supervisorEId' as supervisor_eid
    from active_employment a
    join raw_record r
      on r.source_system = a.source_system
     and r.entity = 'employee'
     and r.source_id = a.source_id
     and r.payload_hash = a.payload_hash
  )
`;

/** Who reports to `managerPersonId` today, by name. */
export async function listDirectReports(
  db: DbOrTx,
  managerPersonId: string,
): Promise<DirectReport[]> {
  const rows = await db.execute(sql`
    ${currentReports}
    select p.id, p.display_name as "displayName"
    from reports rp
    join person p on p.id = rp.report_id
    where rp.supervisor_eid in (
      select i.value
      from source_identity i
      where i.person_id = ${managerPersonId}
        and i.source_system = rp.source_system
        and i.kind = 'bamboo_id'
        and i.valid_to is null
    )
    order by p.display_name, p.id
  `);
  return rows as unknown as DirectReport[];
}

/** People with at least one direct report today, by name. */
export async function listManagers(db: DbOrTx): Promise<DirectReport[]> {
  const rows = await db.execute(sql`
    ${currentReports}
    select distinct p.id, p.display_name as "displayName"
    from reports rp
    join source_identity i
      on i.source_system = rp.source_system
     and i.kind = 'bamboo_id'
     and i.valid_to is null
     and i.value = rp.supervisor_eid
    join person p on p.id = i.person_id
    order by p.display_name, p.id
  `);
  return rows as unknown as DirectReport[];
}
