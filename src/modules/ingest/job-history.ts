import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  employeeJobHistory,
  employeeStatusHistory,
  employment,
  person,
  type SourceSystem,
} from "@/db/schema";
import { bambooId } from "@/modules/bamboo-client/schemas";
// Direct file import (not the identity barrel): see ./employee.ts.
import { normalizeName } from "@/modules/identity/normalize";
import {
  buildJobHistory,
  buildStatusHistory,
  isTermination,
} from "@/modules/org-history/build";
import { canonical } from "./canonical";
import { resolvePerson } from "./employee";
import { optionalDate, optionalText } from "./staging";

const jobInfoRow = z
  .looseObject({
    id: bambooId,
    date: optionalDate,
    location: optionalText,
    department: optionalText,
    division: optionalText,
    jobTitle: optionalText,
    reportsTo: optionalText,
  })
  .transform((r) => ({
    sourceId: r.id,
    date: r.date,
    location: r.location,
    department: r.department,
    division: r.division,
    jobTitle: r.jobTitle,
    reportsTo: r.reportsTo,
  }));

const statusRow = z
  .looseObject({
    id: bambooId,
    date: optionalDate,
    employmentStatus: optionalText,
    comment: optionalText,
  })
  .transform((r) => ({
    sourceId: r.id,
    date: r.date,
    status: r.employmentStatus,
    comment: r.comment,
    terminationRaw: Object.fromEntries(
      Object.entries(r).filter(([k]) => k.startsWith("termination")),
    ),
  }));

/** Validated `job_history` payload (one employee, all its table rows). */
export const stagedJobHistorySchema = z.looseObject({
  employeeId: bambooId,
  jobInfo: z.array(jobInfoRow),
  employmentStatus: z.array(statusRow),
});

export type StagedJobHistory = z.infer<typeof stagedJobHistorySchema>;

export type JobHistoryOutcome = {
  result: "inserted" | "updated" | "unchanged" | "rejected";
  reason?: string;
  managerUnresolved: number;
};

/** Name key (see `normalizeName`) → person id, only for names that exactly one person has. */
export type NameIndex = Map<string, string>;

/**
 * Index of the people whose name is theirs alone. The key is the normalized
 * name (case, accents, punctuation and word order do not matter), so
 * Bamboo's "Páez, Martín" in jobInfo.reportsTo finds the display name
 * "Martin Paez". Namesakes (the same key for two people) are left out: a
 * name that cannot tell them apart must not pick one.
 */
export function buildNameIndex(
  people: readonly { id: string; displayName: string }[],
): NameIndex {
  const holders = new Map<string, string | null>();
  for (const { id, displayName } of people) {
    const key = normalizeName(displayName);
    if (key) holders.set(key, holders.has(key) ? null : id);
  }
  const unique: NameIndex = new Map();
  for (const [key, id] of holders) if (id) unique.set(key, id);
  return unique;
}

/** The one person called `raw` (any "Last, First" / "First Last" spelling), or null. */
export function resolveManagerName(
  index: NameIndex,
  raw: string,
): string | null {
  const key = normalizeName(raw);
  return key ? (index.get(key) ?? null) : null;
}

export async function uniqueNameIndex(tx: DbOrTx): Promise<NameIndex> {
  return buildNameIndex(
    await tx
      .select({ id: person.id, displayName: person.displayName })
      .from(person),
  );
}

type JobValues = {
  validFrom: string;
  validTo: string | null;
  employmentId: string | null;
  managerPersonId: string | null;
  managerRaw: string | null;
  department: string | null;
  division: string | null;
  jobTitle: string | null;
  location: string | null;
  sourceId: string;
};

const jobKeys = [
  "validTo",
  "employmentId",
  "managerPersonId",
  "managerRaw",
  "department",
  "division",
  "jobTitle",
  "location",
  "sourceId",
] as const;

/**
 * Rebuilds the SCD2 history of one employee from all its Bamboo table rows.
 * The manager of the current row comes from the employee's supervisorEId;
 * older rows only have the reportsTo NAME ("Last, First"), matched against
 * the people's display names ("First Last") once both are normalized, and
 * resolved only when exactly one person has it (otherwise null, keeping
 * manager_raw, and counted in managerUnresolved).
 */
export async function upsertJobHistory(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedJobHistory,
  hash: string,
  runId: string,
  names?: NameIndex,
): Promise<JobHistoryOutcome> {
  const personId = await resolvePerson(tx, source, {
    bambooId: staged.employeeId,
  });
  if (!personId) {
    return {
      result: "rejected",
      reason: `unknown employee ${staged.employeeId}: ingest employees first`,
      managerUnresolved: 0,
    };
  }

  const periods = await tx
    .select({
      id: employment.id,
      hireDate: employment.hireDate,
      terminationDate: employment.terminationDate,
      supervisorSourceId: employment.supervisorSourceId,
    })
    .from(employment)
    .where(
      and(
        eq(employment.sourceSystem, source),
        eq(employment.sourceId, staged.employeeId),
        isNull(employment.deletedAt),
      ),
    )
    .orderBy(sql`${employment.hireDate} desc nulls last`);

  // employment.terminationDate (from the employee record) is authoritative;
  // a "Terminated" status row only adds dates the record does not have.
  const terminations = [
    ...periods.flatMap((p) => (p.terminationDate ? [p.terminationDate] : [])),
    ...staged.employmentStatus
      .filter((s) => s.date && isTermination(s.status))
      .map((s) => s.date!),
  ];
  const built = buildJobHistory(staged.jobInfo, terminations);
  const nameIndex = names ?? (await uniqueNameIndex(tx));

  const employmentFor = (from: string) =>
    (
      periods.find((p) => p.hireDate !== null && p.hireDate <= from) ??
      periods[0]
    )?.id ?? null;

  let managerUnresolved = 0;
  const desired: JobValues[] = [];
  for (const [i, r] of built.entries()) {
    let managerPersonId: string | null = null;
    if (i === built.length - 1) {
      // Current supervisor as persisted by the latest employee ingest.
      const sup = periods[0]?.supervisorSourceId;
      if (sup)
        managerPersonId = await resolvePerson(tx, source, { bambooId: sup });
    }
    if (!managerPersonId && r.managerRaw) {
      managerPersonId = resolveManagerName(nameIndex, r.managerRaw);
      if (!managerPersonId) managerUnresolved++;
    }
    desired.push({
      validFrom: r.validFrom,
      validTo: r.validTo,
      employmentId: employmentFor(r.validFrom),
      managerPersonId,
      managerRaw: r.managerRaw,
      department: r.department,
      division: r.division,
      jobTitle: r.jobTitle,
      location: r.location,
      sourceId: r.sourceId,
    });
  }

  const existing = await tx
    .select()
    .from(employeeJobHistory)
    .where(
      and(
        eq(employeeJobHistory.personId, personId),
        eq(employeeJobHistory.sourceSystem, source),
      ),
    );
  const byFrom = new Map(existing.map((e) => [e.validFrom, e]));
  const wanted = new Set(desired.map((d) => d.validFrom));
  const unchanged =
    existing.length === desired.length &&
    desired.every((d) => {
      const e = byFrom.get(d.validFrom);
      return e && !e.deletedAt && jobKeys.every((k) => e[k] === d[k]);
    });

  const statuses = buildStatusHistory(staged.employmentStatus);
  const statusUnchanged = await syncStatusHistory(
    tx,
    source,
    personId,
    staged,
    statuses,
    hash,
    runId,
  );

  if (unchanged && statusUnchanged) {
    return { result: "unchanged", managerUnresolved };
  }

  const now = new Date();
  for (const e of existing) {
    if (!wanted.has(e.validFrom)) {
      await tx
        .delete(employeeJobHistory)
        .where(eq(employeeJobHistory.id, e.id));
    }
  }
  for (const d of desired) {
    const values = {
      ...d,
      ingestRunId: runId,
      payloadHash: hash,
      updatedAt: now,
      deletedAt: null,
    };
    await tx
      .insert(employeeJobHistory)
      .values({ ...values, personId, sourceSystem: source })
      .onConflictDoUpdate({
        target: [employeeJobHistory.personId, employeeJobHistory.validFrom],
        set: values,
      });
  }
  return {
    result: existing.length ? "updated" : "inserted",
    managerUnresolved,
  };
}

/** Rebuilds employee_status_history; true when nothing changed. */
async function syncStatusHistory(
  tx: DbOrTx,
  source: SourceSystem,
  personId: string,
  staged: StagedJobHistory,
  statuses: ReturnType<typeof buildStatusHistory>,
  hash: string,
  runId: string,
): Promise<boolean> {
  const rawById = new Map(staged.employmentStatus.map((s) => [s.sourceId, s]));
  const desired = statuses.map((s) => ({
    validFrom: s.validFrom,
    validTo: s.validTo,
    employmentStatus: s.employmentStatus,
    comment: s.comment,
    terminationRaw: rawById.get(s.sourceId)?.terminationRaw ?? {},
    sourceId: s.sourceId,
  }));
  const existing = await tx
    .select()
    .from(employeeStatusHistory)
    .where(
      and(
        eq(employeeStatusHistory.personId, personId),
        eq(employeeStatusHistory.sourceSystem, source),
      ),
    );
  const byFrom = new Map(existing.map((e) => [e.validFrom, e]));
  const same =
    existing.length === desired.length &&
    desired.every((d) => {
      const e = byFrom.get(d.validFrom);
      return (
        e &&
        e.validTo === d.validTo &&
        e.employmentStatus === d.employmentStatus &&
        e.comment === d.comment &&
        e.sourceId === d.sourceId &&
        canonical(e.terminationRaw ?? {}) === canonical(d.terminationRaw)
      );
    });
  if (same) return true;

  const wanted = new Set(desired.map((d) => d.validFrom));
  for (const e of existing) {
    if (!wanted.has(e.validFrom)) {
      await tx
        .delete(employeeStatusHistory)
        .where(eq(employeeStatusHistory.id, e.id));
    }
  }
  const now = new Date();
  for (const d of desired) {
    const values = {
      ...d,
      ingestRunId: runId,
      payloadHash: hash,
      updatedAt: now,
    };
    await tx
      .insert(employeeStatusHistory)
      .values({ ...values, personId, sourceSystem: source })
      .onConflictDoUpdate({
        target: [
          employeeStatusHistory.personId,
          employeeStatusHistory.validFrom,
        ],
        set: values,
      });
  }
  return false;
}
