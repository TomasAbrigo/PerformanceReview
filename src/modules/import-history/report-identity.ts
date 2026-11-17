import type { DbOrTx } from "@/db/client";
import { person, sourceIdentity, type IdentityKind } from "@/db/schema";

/**
 * Identifiers of the people we know, to place a row of Bamboo's raw reports
 * (#83): `bamboo_id` (the report's EEID), `employee_number` (the number in
 * Assessment Progress) and the work email. A value held by more than one
 * person is not conclusive and is left out. Loaded once per run.
 */
export type IdIndex = Record<IdentityKind, Map<string, string>>;

const normalize = (kind: IdentityKind, value: string) =>
  kind === "work_email" ? value.trim().toLowerCase() : value.trim();

export async function loadIdIndex(db: DbOrTx): Promise<IdIndex> {
  const holders: Record<IdentityKind, Map<string, Set<string>>> = {
    bamboo_id: new Map(),
    employee_number: new Map(),
    work_email: new Map(),
  };
  const add = (kind: IdentityKind, value: string | null, personId: string) => {
    if (!value) return;
    const key = normalize(kind, value);
    const set = holders[kind].get(key) ?? new Set<string>();
    set.add(personId);
    holders[kind].set(key, set);
  };
  // bamboo_id is additive (one per employment): every one counts. Legajo and
  // email are the current value only.
  const identities = await db
    .select({
      personId: sourceIdentity.personId,
      kind: sourceIdentity.kind,
      value: sourceIdentity.value,
      validTo: sourceIdentity.validTo,
    })
    .from(sourceIdentity);
  for (const row of identities) {
    if (row.kind !== "bamboo_id" && row.validTo !== null) continue;
    add(row.kind, row.value, row.personId);
  }
  const people = await db
    .select({ id: person.id, email: person.workEmail })
    .from(person);
  for (const row of people) add("work_email", row.email, row.id);

  const index = {} as IdIndex;
  for (const kind of Object.keys(holders) as IdentityKind[]) {
    index[kind] = new Map(
      [...holders[kind]]
        .filter(([, ids]) => ids.size === 1)
        .map(([value, ids]) => [value, [...ids][0]]),
    );
  }
  return index;
}

export async function idIndexOf(
  db: DbOrTx,
  cache: Map<string, unknown>,
): Promise<IdIndex> {
  let index = cache.get("idIndex") as IdIndex | undefined;
  if (!index) {
    index = await loadIdIndex(db);
    cache.set("idIndex", index);
  }
  return index;
}

export type RowIds = Partial<Record<IdentityKind, string | null>>;

/** The person the row's ids point to: EEID, then legajo, then email. */
export function matchIds(index: IdIndex, ids: RowIds): string | null {
  for (const kind of ["bamboo_id", "employee_number", "work_email"] as const) {
    const value = ids[kind];
    if (!value) continue;
    const found = index[kind].get(normalize(kind, value));
    if (found) return found;
  }
  return null;
}
