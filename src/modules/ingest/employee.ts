import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  employment,
  person,
  sourceIdentity,
  type Employment,
  type IdentityKind,
  type SourceSystem,
} from "@/db/schema";
import type { StagedEmployee } from "./staging";

/**
 * Identity resolution seam. Minimal for now: match on the source's own id
 * (bamboo_id). Matching by employee_number / email and the manual-review
 * queue belong to the identity module (issue #5).
 */
export async function resolvePerson(
  tx: DbOrTx,
  source: SourceSystem,
  { bambooId }: { bambooId: string },
): Promise<string | null> {
  const [match] = await tx
    .select({ personId: sourceIdentity.personId })
    .from(sourceIdentity)
    .where(
      and(
        eq(sourceIdentity.sourceSystem, source),
        eq(sourceIdentity.kind, "bamboo_id"),
        eq(sourceIdentity.value, bambooId),
        isNull(sourceIdentity.validTo),
      ),
    );
  return match?.personId ?? null;
}

/**
 * Makes `value` the person's open identity of `kind`. If another person holds
 * it open, nothing changes and a conflict reason is returned (for #5's
 * queue); the old identity is only closed after the new one is in place.
 */
async function syncIdentity(
  tx: DbOrTx,
  personId: string,
  source: SourceSystem,
  kind: IdentityKind,
  value: string | null,
  now: Date,
): Promise<string | null> {
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
    if (holder) {
      return `identity_conflict: ${kind}=${value} is held by person ${holder.personId}`;
    }
    await tx
      .insert(sourceIdentity)
      .values({ personId, sourceSystem: source, kind, value, validFrom: now });
  }
  for (const c of current) {
    await tx
      .update(sourceIdentity)
      .set({ validTo: now, updatedAt: now })
      .where(eq(sourceIdentity.id, c.id));
  }
  return null;
}

async function syncIdentities(
  tx: DbOrTx,
  personId: string,
  source: SourceSystem,
  staged: StagedEmployee,
  now: Date,
): Promise<string[]> {
  const wanted: [IdentityKind, string | null][] = [
    ["bamboo_id", staged.sourceId],
    ["employee_number", staged.employeeNumber],
    ["work_email", staged.workEmail],
  ];
  const conflicts: string[] = [];
  for (const [kind, value] of wanted) {
    const conflict = await syncIdentity(tx, personId, source, kind, value, now);
    if (conflict) conflicts.push(conflict);
  }
  return conflicts;
}

/**
 * Picks the employment period a payload describes: same hire date, else a
 * new period when it is a rehire after a termination, else the latest one
 * (e.g. a corrected hire date).
 */
function targetPeriod(
  periods: Employment[],
  staged: StagedEmployee,
): Employment | "new" {
  const same = periods.find((p) => p.hireDate === staged.hireDate);
  if (same) return same;
  const latest = periods[0];
  if (!latest) return "new";
  const rehire =
    latest.terminationDate !== null &&
    staged.hireDate !== null &&
    latest.hireDate !== null &&
    staged.hireDate > latest.hireDate;
  return rehire ? "new" : latest;
}

export type EmployeeOutcome = {
  result: "inserted" | "updated" | "unchanged";
  conflicts: string[];
};

export async function upsertEmployee(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedEmployee,
  hash: string,
  runId: string,
): Promise<EmployeeOutcome> {
  const now = new Date();
  const periods = await tx
    .select()
    .from(employment)
    .where(
      and(
        eq(employment.sourceSystem, source),
        eq(employment.sourceId, staged.sourceId),
      ),
    )
    .orderBy(sql`${employment.hireDate} desc nulls last`);
  const target = targetPeriod(periods, staged);

  if (target !== "new" && target.payloadHash === hash && !target.deletedAt) {
    return { result: "unchanged", conflicts: [] };
  }

  const employmentValues = {
    hireDate: staged.hireDate,
    terminationDate: staged.terminationDate,
    status: staged.status,
    supervisorSourceId: staged.supervisorSourceId,
    ingestRunId: runId,
    payloadHash: hash,
    updatedAt: now,
    deletedAt: null,
  };

  let personId =
    periods[0]?.personId ??
    (await resolvePerson(tx, source, { bambooId: staged.sourceId }));
  if (personId) {
    await tx
      .update(person)
      .set({
        displayName: staged.displayName,
        workEmail: staged.workEmail,
        updatedAt: now,
      })
      .where(eq(person.id, personId));
  } else {
    const [created] = await tx
      .insert(person)
      .values({ displayName: staged.displayName, workEmail: staged.workEmail })
      .returning({ id: person.id });
    personId = created.id;
  }
  const conflicts = await syncIdentities(tx, personId, source, staged, now);

  if (target === "new") {
    await tx.insert(employment).values({
      ...employmentValues,
      personId,
      sourceSystem: source,
      sourceId: staged.sourceId,
    });
    return { result: periods.length ? "updated" : "inserted", conflicts };
  }
  await tx
    .update(employment)
    .set(employmentValues)
    .where(eq(employment.id, target.id));
  return { result: "updated", conflicts };
}
