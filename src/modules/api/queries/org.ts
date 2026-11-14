import { and, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { jobValidOn, rowsOf } from "@/lib/sql";
import { encodeCursor, pageOf, type Page } from "../pagination";
import { afterId, identityCtes, personRef, type PersonRef } from "./shared";

export type OrgRow = {
  /** employee_job_history id. */
  id: string;
  sourceSystem: string;
  sourceId: string | null;
  person: PersonRef;
  /** Legajo of the person. */
  employeeNumber: string | null;
  manager: PersonRef | null;
  managerRaw: string | null;
  validFrom: string;
  validTo: string | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  location: string | null;
};

type Raw = Omit<OrgRow, "person" | "manager"> & {
  personId: string;
  personSystem: string | null;
  personBambooId: string | null;
  personName: string;
  managerId: string | null;
  managerSystem: string | null;
  managerBambooId: string | null;
  managerName: string | null;
};

/**
 * Everyone with a job row valid on `date` (YYYY-MM-DD), with the manager of
 * that day. Ordered by the row id: immutable, so pages never shift.
 */
export async function listOrgAsOf(
  db: DbOrTx,
  {
    date,
    limit,
    cursor,
  }: { date: string; limit: number; cursor?: string | null },
): Promise<Page<OrgRow>> {
  const raw = rowsOf<Raw>(
    await db.execute(sql`
      with ${identityCtes}
      select h.id, h.source_system as "sourceSystem", h.source_id as "sourceId",
        h.person_id as "personId", p.display_name as "personName",
        bi.source_system as "personSystem", bi.value as "personBambooId",
        en.value as "employeeNumber",
        h.manager_person_id as "managerId",
        mbi.source_system as "managerSystem", mbi.value as "managerBambooId",
        mp.display_name as "managerName", h.manager_raw as "managerRaw",
        h.valid_from::text as "validFrom", h.valid_to::text as "validTo",
        h.department, h.division, h.job_title as "jobTitle", h.location
      from employee_job_history h
      join person p on p.id = h.person_id
      left join bamboo_identity bi on bi.person_id = h.person_id
      left join employee_number en on en.person_id = h.person_id
      left join person mp on mp.id = h.manager_person_id
      left join bamboo_identity mbi on mbi.person_id = h.manager_person_id
      where ${and(jobValidOn("h", date), afterId("h.id", cursor)) ?? sql`true`}
      order by h.id
      limit ${limit + 1}
    `),
  );
  const rows: OrgRow[] = raw.map(
    ({
      personId,
      personSystem,
      personBambooId,
      personName,
      managerId,
      managerSystem,
      managerBambooId,
      managerName,
      ...row
    }) => ({
      ...row,
      person: personRef(personId, personSystem, personBambooId, personName)!,
      manager: personRef(
        managerId,
        managerSystem,
        managerBambooId,
        managerName,
      ),
    }),
  );
  return pageOf(rows, limit, (r) => encodeCursor([r.id]));
}
