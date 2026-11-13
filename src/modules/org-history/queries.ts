import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  employeeJobHistory,
  person,
  type EmployeeJobHistory,
} from "@/db/schema";

/** ISO date (YYYY-MM-DD). Intervals are [valid_from, valid_to). */
export type IsoDate = string;

/** Job rows valid on `date` (not soft-deleted). */
export const jobValidOn = (date: IsoDate) =>
  and(
    isNull(employeeJobHistory.deletedAt),
    lte(employeeJobHistory.validFrom, date),
    or(
      isNull(employeeJobHistory.validTo),
      gt(employeeJobHistory.validTo, date),
    ),
  );

/** The job/manager row of `personId` valid on `date`, or null. */
export async function jobAsOf(
  db: DbOrTx,
  personId: string,
  date: IsoDate,
): Promise<EmployeeJobHistory | null> {
  const [row] = await db
    .select()
    .from(employeeJobHistory)
    .where(and(eq(employeeJobHistory.personId, personId), jobValidOn(date)))
    .limit(1);
  return row ?? null;
}

/** Job rows valid on `date` for many people in one query, keyed by person id. */
export async function jobsAsOf(
  db: DbOrTx,
  personIds: string[],
  date: IsoDate,
): Promise<Map<string, EmployeeJobHistory>> {
  if (personIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(employeeJobHistory)
    .where(
      and(inArray(employeeJobHistory.personId, personIds), jobValidOn(date)),
    );
  return new Map(rows.map((r) => [r.personId, r]));
}

/**
 * Manager (person id) of `personId` on `date`; null when there was no job row
 * that day (not hired yet, terminated) or the manager is unknown.
 */
export async function managerAsOf(
  db: DbOrTx,
  personId: string,
  date: IsoDate,
): Promise<string | null> {
  return (await jobAsOf(db, personId, date))?.managerPersonId ?? null;
}

export type JobHistoryItem = {
  id: string;
  validFrom: string;
  validTo: string | null;
  jobTitle: string | null;
  department: string | null;
  division: string | null;
  location: string | null;
  managerPersonId: string | null;
  managerName: string | null;
  /** reportsTo as Bamboo had it (shown when the manager is unresolved). */
  managerRaw: string | null;
};

/** Job history of a person, newest first. */
export async function getJobHistory(
  db: DbOrTx,
  personId: string,
): Promise<JobHistoryItem[]> {
  const manager = aliasedTable(person, "manager");
  return db
    .select({
      id: employeeJobHistory.id,
      validFrom: employeeJobHistory.validFrom,
      validTo: employeeJobHistory.validTo,
      jobTitle: employeeJobHistory.jobTitle,
      department: employeeJobHistory.department,
      division: employeeJobHistory.division,
      location: employeeJobHistory.location,
      managerPersonId: employeeJobHistory.managerPersonId,
      managerName: manager.displayName,
      managerRaw: employeeJobHistory.managerRaw,
    })
    .from(employeeJobHistory)
    .leftJoin(manager, eq(manager.id, employeeJobHistory.managerPersonId))
    .where(
      and(
        eq(employeeJobHistory.personId, personId),
        isNull(employeeJobHistory.deletedAt),
      ),
    )
    .orderBy(desc(employeeJobHistory.validFrom));
}

export type OrgNode = {
  personId: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  /** Parent in the tree; null for roots (no manager, or manager not in the org that day). */
  parentId: string | null;
  depth: number;
};

/**
 * Org chart on `date`: everyone with a job row valid that day, nested under
 * their manager when the manager is also in the org that day. Depth-first
 * order (siblings by name), so it renders as an indented tree directly.
 */
export async function orgTreeAsOf(
  db: DbOrTx,
  date: IsoDate,
): Promise<OrgNode[]> {
  const rows = await db.execute<{
    person_id: string;
    display_name: string;
    job_title: string | null;
    department: string | null;
    parent_id: string | null;
    depth: number;
  }>(sql`
    with recursive active as (
      select h.person_id, h.manager_person_id, h.job_title, h.department,
             p.display_name
      from ${employeeJobHistory} h
      join ${person} p on p.id = h.person_id
      where h.deleted_at is null
        and h.valid_from <= ${date}::date
        and (h.valid_to is null or h.valid_to > ${date}::date)
    ),
    tree as (
      select a.person_id, a.display_name, a.job_title, a.department,
             null::uuid as parent_id, 0 as depth,
             array[a.display_name || ' ' || a.person_id::text] as path,
             array[a.person_id] as ids
      from active a
      where a.manager_person_id is null
         or not exists (select 1 from active m where m.person_id = a.manager_person_id)
      union all
      select c.person_id, c.display_name, c.job_title, c.department,
             t.person_id, t.depth + 1,
             t.path || (c.display_name || ' ' || c.person_id::text),
             t.ids || c.person_id
      from active c
      join tree t on c.manager_person_id = t.person_id
      where not c.person_id = any(t.ids)
    )
    select person_id, display_name, job_title, department, parent_id, depth
    from tree
    order by path
  `);
  return [...rows].map((r) => ({
    personId: r.person_id,
    displayName: r.display_name,
    jobTitle: r.job_title,
    department: r.department,
    parentId: r.parent_id,
    depth: Number(r.depth),
  }));
}
