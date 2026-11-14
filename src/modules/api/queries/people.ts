import { and, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import { todayLocal } from "@/modules/org-history/dates";
import { activeEmploymentCteOn } from "@/modules/people/employment";
import { peopleListWhere } from "@/modules/people/queries";
import { encodeCursor, pageOf, type Page } from "../pagination";
import {
  afterTsId,
  currentJobJoin,
  identityCtes,
  iso,
  personRef,
  type PersonRef,
} from "./shared";

export type CurrentJob = {
  /** employee_job_history id. */
  id: string;
  validFrom: string;
  manager: PersonRef | null;
  managerRaw: string | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  location: string | null;
};

export type PersonRow = {
  id: string;
  displayName: string;
  workEmail: string | null;
  /** Of the open bamboo_id identity. */
  sourceSystem: string | null;
  bambooId: string | null;
  /** Legajo. */
  employeeNumber: string | null;
  /** Status of the latest live employment. */
  status: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  /** Employed on the as-of day (see `activeEmploymentCteOn`). */
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Job row valid today; null when there is none. */
  job: CurrentJob | null;
};

type RawPersonRow = Omit<PersonRow, "job"> & {
  jobId: string | null;
  jobValidFrom: string | null;
  managerId: string | null;
  managerSystem: string | null;
  managerBambooId: string | null;
  managerName: string | null;
  managerRaw: string | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  location: string | null;
};

function toPersonRow(r: RawPersonRow): PersonRow {
  const {
    jobId,
    jobValidFrom,
    managerId,
    managerSystem,
    managerBambooId,
    managerName,
    managerRaw,
    department,
    division,
    jobTitle,
    location,
    ...person
  } = r;
  return {
    ...person,
    job:
      jobId === null
        ? null
        : {
            id: jobId,
            validFrom: jobValidFrom!,
            manager: personRef(
              managerId,
              managerSystem,
              managerBambooId,
              managerName,
            ),
            managerRaw,
            department,
            division,
            jobTitle,
            location,
          },
  };
}

export type ListPeopleInput = {
  limit: number;
  cursor?: string | null;
  /** Substring of the name or email, case-insensitive. */
  q?: string;
  active?: boolean;
  /** The day "active" and the current job are read at (default: today). */
  asOf?: string;
};

/**
 * The people the people screen lists (live employment), oldest first by
 * (created_at, id): rows arriving later never shift earlier pages.
 */
export async function listPeopleRows(
  db: DbOrTx,
  { limit, cursor, q, active, asOf = todayLocal() }: ListPeopleInput,
): Promise<Page<PersonRow>> {
  const rows = await selectPeople(
    db,
    and(
      peopleListWhere("p", q),
      afterTsId("p.created_at", "p.id", cursor),
      active === undefined
        ? undefined
        : active
          ? sql`ae.person_id is not null`
          : sql`ae.person_id is null`,
    ) ?? sql`true`,
    limit + 1,
    asOf,
  );
  return pageOf(rows, limit, (r) => encodeCursor([r.createdAt, r.id]));
}

async function selectPeople(
  db: DbOrTx,
  where: SQL,
  limit: number,
  asOf: string,
): Promise<PersonRow[]> {
  const rows = rowsOf<RawPersonRow>(
    await db.execute(sql`
      with ${activeEmploymentCteOn(asOf)}, ${identityCtes}
      select p.id, p.display_name as "displayName", p.work_email as "workEmail",
        bi.source_system as "sourceSystem", bi.value as "bambooId",
        en.value as "employeeNumber",
        le.status, le.hire_date::text as "hireDate",
        le.termination_date::text as "terminationDate",
        (ae.person_id is not null) as active,
        ${iso("p.created_at")} as "createdAt",
        ${iso("p.updated_at")} as "updatedAt",
        j.id as "jobId", j.valid_from::text as "jobValidFrom",
        j.manager_person_id as "managerId",
        mbi.source_system as "managerSystem", mbi.value as "managerBambooId",
        mp.display_name as "managerName", j.manager_raw as "managerRaw",
        j.department, j.division, j.job_title as "jobTitle", j.location
      from person p
      left join bamboo_identity bi on bi.person_id = p.id
      left join employee_number en on en.person_id = p.id
      left join lateral (
        select e.status, e.hire_date, e.termination_date
        from employment e
        where e.person_id = p.id and e.deleted_at is null
        order by e.hire_date desc nulls last, e.id
        limit 1
      ) le on true
      left join active_employment ae on ae.person_id = p.id
      ${currentJobJoin("p.id", asOf)}
      left join person mp on mp.id = j.manager_person_id
      left join bamboo_identity mbi on mbi.person_id = j.manager_person_id
      where ${where}
      order by p.created_at, p.id
      limit ${limit}
    `),
  );
  return rows.map(toPersonRow);
}

export type IdentityRow = {
  id: string;
  sourceSystem: string;
  kind: string;
  value: string;
  validFrom: string;
  validTo: string | null;
};

export type EmploymentRow = {
  id: string;
  sourceSystem: string;
  sourceId: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  status: string | null;
  supervisorSourceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobHistoryRow = {
  id: string;
  sourceSystem: string;
  sourceId: string | null;
  employmentId: string | null;
  validFrom: string;
  validTo: string | null;
  manager: PersonRef | null;
  managerRaw: string | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonDetail = PersonRow & {
  identities: IdentityRow[];
  employments: EmploymentRow[];
  jobHistory: JobHistoryRow[];
};

/** A person with identities, employment periods and job history; null if unknown. */
export async function getPersonDetail(
  db: DbOrTx,
  id: string,
  asOf = todayLocal(),
): Promise<PersonDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = await selectPeople(db, sql`p.id = ${id}::uuid`, 1, asOf);
  if (!row) return null;

  const identities = rowsOf<IdentityRow>(
    await db.execute(sql`
      select i.id, i.source_system as "sourceSystem", i.kind, i.value,
        ${iso("i.valid_from")} as "validFrom", ${iso("i.valid_to")} as "validTo"
      from source_identity i
      where i.person_id = ${id}::uuid
      order by i.kind, i.valid_from desc, i.id
    `),
  );
  const employments = rowsOf<EmploymentRow>(
    await db.execute(sql`
      select e.id, e.source_system as "sourceSystem", e.source_id as "sourceId",
        e.hire_date::text as "hireDate",
        e.termination_date::text as "terminationDate", e.status,
        e.supervisor_source_id as "supervisorSourceId",
        ${iso("e.created_at")} as "createdAt", ${iso("e.updated_at")} as "updatedAt"
      from employment e
      where e.person_id = ${id}::uuid and e.deleted_at is null
      order by e.hire_date desc nulls last, e.id
    `),
  );
  const jobs = rowsOf<
    Omit<JobHistoryRow, "manager"> & {
      managerId: string | null;
      managerSystem: string | null;
      managerBambooId: string | null;
      managerName: string | null;
    }
  >(
    await db.execute(sql`
      with ${identityCtes}
      select h.id, h.source_system as "sourceSystem", h.source_id as "sourceId",
        h.employment_id as "employmentId",
        h.valid_from::text as "validFrom", h.valid_to::text as "validTo",
        h.manager_person_id as "managerId",
        mbi.source_system as "managerSystem", mbi.value as "managerBambooId",
        mp.display_name as "managerName", h.manager_raw as "managerRaw",
        h.department, h.division, h.job_title as "jobTitle", h.location,
        ${iso("h.created_at")} as "createdAt", ${iso("h.updated_at")} as "updatedAt"
      from employee_job_history h
      left join person mp on mp.id = h.manager_person_id
      left join bamboo_identity mbi on mbi.person_id = h.manager_person_id
      where h.person_id = ${id}::uuid and h.deleted_at is null
      order by h.valid_from desc, h.id
    `),
  );
  return {
    ...row,
    identities,
    employments,
    jobHistory: jobs.map(
      ({ managerId, managerSystem, managerBambooId, managerName, ...job }) => ({
        ...job,
        manager: personRef(
          managerId,
          managerSystem,
          managerBambooId,
          managerName,
        ),
      }),
    ),
  };
}

/** Whether a person with this id exists (a malformed id never does). */
export async function personExists(db: DbOrTx, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = rowsOf<{ id: string }>(
    await db.execute(sql`select id from person where id = ${id}::uuid`),
  );
  return rows.length > 0;
}
