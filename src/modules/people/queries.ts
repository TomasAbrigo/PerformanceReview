import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
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

/**
 * Who the people list shows, for the screen, the JSON API and the CSV export
 * alike: people with at least one live (not soft-deleted) employment,
 * optionally matching a name/email substring (case-insensitive). `alias` is
 * how the query names the person table.
 */
export function peopleListWhere(alias: string, query = ""): SQL {
  const q = query.trim();
  const person = sql.raw(`"${alias}"`);
  const live = sql`exists (select 1 from ${employment} e
    where e.person_id = ${person}.id and e.deleted_at is null)`;
  if (!q) return live;
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`${live} and (${person}.display_name ilike ${pattern} or ${person}.work_email ilike ${pattern})`;
}

/**
 * People, optionally filtered by name/email substring (case-insensitive) and
 * capped at `limit` (after sorting by name).
 */
export async function listPeople(
  db: DbOrTx,
  query = "",
  { limit }: { limit?: number } = {},
): Promise<PersonListItem[]> {
  const latestStatus = sql<string | null>`(
    select e.status from ${employment} e
    where e.person_id = "person"."id" and e.deleted_at is null
    order by e.hire_date desc nulls last limit 1
  )`;
  const list = db
    .select({
      id: person.id,
      displayName: person.displayName,
      workEmail: person.workEmail,
      status: latestStatus,
    })
    .from(person)
    .where(peopleListWhere("person", query))
    .orderBy(asc(person.displayName));
  return limit === undefined ? list : list.limit(limit);
}

export async function getPerson(
  db: DbOrTx,
  id: string,
): Promise<PersonDetailData | null> {
  if (!isUuid(id)) return null;
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
