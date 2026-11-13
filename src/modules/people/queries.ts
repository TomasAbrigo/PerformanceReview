import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  employment,
  person,
  sourceIdentity,
  type IdentityKind,
} from "@/db/schema";

export type PersonListItem = {
  id: string;
  displayName: string;
  workEmail: string | null;
  /** Status of the most recent employment. */
  status: string | null;
};

export type PersonDetailData = {
  id: string;
  displayName: string;
  workEmail: string | null;
  identities: {
    kind: IdentityKind;
    value: string;
    validFrom: Date;
    validTo: Date | null;
  }[];
  employments: {
    id: string;
    hireDate: string | null;
    terminationDate: string | null;
    status: string | null;
  }[];
};

/** People, optionally filtered by name/email substring (case-insensitive). */
export async function listPeople(
  db: Database,
  query = "",
): Promise<PersonListItem[]> {
  const q = query.trim();
  const latestStatus = sql<string | null>`(
    select e.status from ${employment} e
    where e.person_id = "person"."id" and e.deleted_at is null
    order by e.hire_date desc nulls last limit 1
  )`;
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select({
      id: person.id,
      displayName: person.displayName,
      workEmail: person.workEmail,
      status: latestStatus,
    })
    .from(person)
    .where(
      q
        ? or(
            ilike(person.displayName, pattern),
            ilike(person.workEmail, pattern),
          )
        : undefined,
    )
    .orderBy(asc(person.displayName));
}

export async function getPerson(
  db: Database,
  id: string,
): Promise<PersonDetailData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await db.select().from(person).where(eq(person.id, id));
  if (!p) return null;
  const identities = await db
    .select({
      kind: sourceIdentity.kind,
      value: sourceIdentity.value,
      validFrom: sourceIdentity.validFrom,
      validTo: sourceIdentity.validTo,
    })
    .from(sourceIdentity)
    .where(eq(sourceIdentity.personId, id))
    .orderBy(asc(sourceIdentity.kind), desc(sourceIdentity.validFrom));
  const employments = await db
    .select({
      id: employment.id,
      hireDate: employment.hireDate,
      terminationDate: employment.terminationDate,
      status: employment.status,
    })
    .from(employment)
    .where(and(eq(employment.personId, id), isNull(employment.deletedAt)))
    .orderBy(desc(employment.hireDate));
  return {
    id: p.id,
    displayName: p.displayName,
    workEmail: p.workEmail,
    identities,
    employments,
  };
}
