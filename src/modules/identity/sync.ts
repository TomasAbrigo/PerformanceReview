import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  employment,
  person,
  sourceIdentity,
  type IdentityKind,
  type SourceSystem,
} from "@/db/schema";
import type { StagedEmployee } from "@/modules/ingest/staging";

/** An identifier a record carries that another person already holds. */
export type IdentityConflict = {
  kind: IdentityKind;
  value: string;
  holderPersonId: string;
};

/**
 * Makes `value` the person's open identity of `kind`. If another person holds
 * it open, nothing changes and the conflict is returned; the old identity is
 * only closed after the new one is in place.
 *
 * A person can have several Bamboo ids (one per employment after a rehire
 * under a new id), so `bamboo_id` is additive. Legajo and email are the
 * person's current value: a new one replaces the old.
 */
async function syncIdentity(
  tx: DbOrTx,
  personId: string,
  source: SourceSystem,
  kind: IdentityKind,
  value: string | null,
  now: Date,
): Promise<IdentityConflict | null> {
  const open = and(
    eq(sourceIdentity.sourceSystem, source),
    eq(sourceIdentity.kind, kind),
    isNull(sourceIdentity.validTo),
  );
  const current = await tx
    .select()
    .from(sourceIdentity)
    .where(and(open, eq(sourceIdentity.personId, personId)));
  if (current.some((c) => c.value === value)) return null;

  if (value !== null) {
    const [holder] = await tx
      .select({ personId: sourceIdentity.personId })
      .from(sourceIdentity)
      .where(
        and(
          open,
          eq(sourceIdentity.value, value),
          ne(sourceIdentity.personId, personId),
        ),
      );
    if (holder) return { kind, value, holderPersonId: holder.personId };
    await tx
      .insert(sourceIdentity)
      .values({ personId, sourceSystem: source, kind, value, validFrom: now });
  }
  if (kind === "bamboo_id") return null;
  for (const c of current) {
    await tx
      .update(sourceIdentity)
      .set({ validTo: now, updatedAt: now })
      .where(eq(sourceIdentity.id, c.id));
  }
  return null;
}

/**
 * Whether `staged` describes who the person is today. It does not when the
 * person has another employment (under another source id) that is later, or
 * that is active while this one is terminated: a change to an old stint must
 * not overwrite the identifiers of the current one.
 */
export async function isCurrentStint(
  tx: DbOrTx,
  personId: string,
  staged: StagedEmployee,
): Promise<boolean> {
  const supersedes = [
    staged.hireDate ? gt(employment.hireDate, staged.hireDate) : undefined,
    staged.terminationDate ? isNull(employment.terminationDate) : undefined,
  ].filter((c) => c !== undefined);
  if (supersedes.length === 0) return true;
  const [other] = await tx
    .select({ id: employment.id })
    .from(employment)
    .where(
      and(
        eq(employment.personId, personId),
        isNull(employment.deletedAt),
        ne(employment.sourceId, staged.sourceId),
        or(...supersedes),
      ),
    )
    .limit(1);
  return !other;
}

/**
 * Syncs the record's identifiers onto the person (a past stint only adds its
 * Bamboo id) and returns the ones another person already holds.
 */
export async function syncIdentities(
  tx: DbOrTx,
  personId: string,
  source: SourceSystem,
  staged: StagedEmployee,
  now: Date,
  current = true,
): Promise<IdentityConflict[]> {
  const wanted: [IdentityKind, string | null][] = [
    ["bamboo_id", staged.sourceId],
  ];
  if (current) {
    wanted.push(
      ["employee_number", staged.employeeNumber],
      ["work_email", staged.workEmail],
    );
  }
  const conflicts: IdentityConflict[] = [];
  for (const [kind, value] of wanted) {
    const conflict = await syncIdentity(tx, personId, source, kind, value, now);
    if (conflict) conflicts.push(conflict);
  }
  return conflicts;
}

/** A new golden person for a record that matched nobody. */
export async function createPerson(
  tx: DbOrTx,
  staged: StagedEmployee,
): Promise<string> {
  const [created] = await tx
    .insert(person)
    .values({ displayName: staged.displayName, workEmail: staged.workEmail })
    .returning({ id: person.id });
  return created.id;
}

/** Sets the person's name and email from the record. */
export async function updatePerson(
  tx: DbOrTx,
  personId: string,
  staged: StagedEmployee,
  now: Date,
) {
  await tx
    .update(person)
    .set({
      displayName: staged.displayName,
      workEmail: staged.workEmail,
      updatedAt: now,
    })
    .where(eq(person.id, personId));
}
