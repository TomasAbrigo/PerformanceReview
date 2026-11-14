import { and, eq, isNull, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  employment,
  person,
  sourceIdentity,
  type IdentityCandidate,
  type IdentityMatchKind,
  type SourceSystem,
} from "@/db/schema";
import type { StagedEmployee } from "@/modules/ingest/staging";
import { normalizeName } from "./normalize";

/**
 * How strongly each key points at a person. The source's own id is
 * conclusive; legajo and email are strong but can be reused (rehires, shared
 * mailboxes); name + hire date is a hint a human must confirm.
 */
const WEIGHTS: Record<IdentityMatchKind, number> = {
  bamboo_id: 1,
  employee_number: 0.8,
  work_email: 0.7,
  name_hire_date: 0.4,
  // Report exports: a name alone (src/modules/import-history/names.ts).
  name: 0.3,
};
const ORDER: IdentityMatchKind[] = [
  "bamboo_id",
  "employee_number",
  "work_email",
  "name_hire_date",
];

/** Groups (person, key) pairs into candidates, best first. */
export function toCandidates(
  pairs: Iterable<[personId: string, kind: IdentityMatchKind]>,
): IdentityCandidate[] {
  const byPerson = new Map<string, Set<IdentityMatchKind>>();
  for (const [personId, kind] of pairs) {
    byPerson.set(personId, (byPerson.get(personId) ?? new Set()).add(kind));
  }
  return [...byPerson]
    .map(([personId, kinds]) => {
      const matchedOn = ORDER.filter((k) => kinds.has(k));
      const miss = matchedOn.reduce((p, k) => p * (1 - WEIGHTS[k]), 1);
      return { personId, score: Math.round((1 - miss) * 100) / 100, matchedOn };
    })
    .sort((a, b) => b.score - a.score || a.personId.localeCompare(b.personId));
}

/**
 * People a record might be, by the matching order of the PRD: legajo, then
 * normalized email, then normalized name + hire date. None of these links
 * anything: they only propose.
 */
export async function findCandidates(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedEmployee,
): Promise<IdentityCandidate[]> {
  const pairs: [string, IdentityMatchKind][] = [];

  const keys = [
    ["employee_number", staged.employeeNumber],
    ["work_email", staged.workEmail],
  ] as const;
  const wanted = keys.flatMap(([kind, value]) =>
    value
      ? [and(eq(sourceIdentity.kind, kind), eq(sourceIdentity.value, value))]
      : [],
  );
  if (wanted.length) {
    const rows = await tx
      .select({ personId: sourceIdentity.personId, kind: sourceIdentity.kind })
      .from(sourceIdentity)
      .where(
        and(
          eq(sourceIdentity.sourceSystem, source),
          isNull(sourceIdentity.validTo),
          or(...wanted),
        ),
      );
    for (const r of rows) pairs.push([r.personId, r.kind as IdentityMatchKind]);
  }

  if (staged.hireDate) {
    const name = normalizeName(staged.displayName);
    const sameHire = await tx
      .select({ personId: person.id, displayName: person.displayName })
      .from(person)
      .innerJoin(employment, eq(employment.personId, person.id))
      .where(
        and(
          eq(employment.hireDate, staged.hireDate),
          isNull(employment.deletedAt),
        ),
      );
    for (const r of sameHire) {
      if (normalizeName(r.displayName) === name) {
        pairs.push([r.personId, "name_hire_date"]);
      }
    }
  }
  return toCandidates(pairs);
}
