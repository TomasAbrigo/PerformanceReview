import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  employeeJobHistory,
  employeeStatusHistory,
  employment,
  person,
  rawRecord,
  sourceIdentity,
  type SourceSystem,
} from "@/db/schema";
import { bambooId } from "@/modules/bamboo-client/schemas";
import {
  buildJobHistory,
  buildStatusHistory,
  isTermination,
} from "@/modules/org-history/build";
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

async function personByBambooId(
  tx: DbOrTx,
  source: SourceSystem,
  id: string,
): Promise<string | null> {
  const [m] = await tx
    .select({ personId: sourceIdentity.personId })
    .from(sourceIdentity)
    .where(
      and(
        eq(sourceIdentity.sourceSystem, source),
        eq(sourceIdentity.kind, "bamboo_id"),
        eq(sourceIdentity.value, id),
        isNull(sourceIdentity.validTo),
      ),
    );
  return m?.personId ?? null;
}

/** supervisorEId of the latest extracted employee payload. */
async function currentSupervisor(
  tx: DbOrTx,
  source: SourceSystem,
  employeeId: string,
): Promise<string | null> {
  const [latest] = await tx
    .select({ payload: rawRecord.payload })
    .from(rawRecord)
    .where(
      and(
        eq(rawRecord.sourceSystem, source),
        eq(rawRecord.entity, "employee"),
        eq(rawRecord.sourceId, employeeId),
      ),
    )
    .orderBy(desc(rawRecord.extractedAt))
    .limit(1);
  const id = (latest?.payload as { supervisorEId?: unknown } | undefined)
    ?.supervisorEId;
  return id == null || id === "" ? null : String(id);
}

/** A person whose display name is exactly `name`, only if exactly one. */
async function personByUniqueName(
  tx: DbOrTx,
  name: string,
): Promise<string | null> {
  const matches = await tx
    .select({ id: person.id })
    .from(person)
    .where(eq(person.displayName, name))
    .limit(2);
  return matches.length === 1 ? matches[0].id : null;
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
 * older rows only have the reportsTo NAME, resolved only when exactly one
 * person has it (otherwise null, keeping manager_raw).
 */
export async function upsertJobHistory(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedJobHistory,
  hash: string,
  runId: string,
): Promise<JobHistoryOutcome> {
  const personId = await personByBambooId(tx, source, staged.employeeId);
  if (!personId) {
    return {
      result: "rejected",
      reason: `unknown employee ${staged.employeeId}: ingest employees first`,
      managerUnresolved: 0,
    };
  }

  const terminations = staged.employmentStatus
    .filter((s) => s.date && isTermination(s.status))
    .map((s) => s.date!);
  const built = buildJobHistory(staged.jobInfo, terminations);

  const periods = await tx
    .select({ id: employment.id, hireDate: employment.hireDate })
    .from(employment)
    .where(
      and(
        eq(employment.sourceSystem, source),
        eq(employment.sourceId, staged.employeeId),
        isNull(employment.deletedAt),
      ),
    )
    .orderBy(sql`${employment.hireDate} desc nulls last`);
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
      const sup = await currentSupervisor(tx, source, staged.employeeId);
      if (sup) managerPersonId = await personByBambooId(tx, source, sup);
    }
    if (!managerPersonId && r.managerRaw) {
      managerPersonId = await personByUniqueName(tx, r.managerRaw);
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

const sortedJson = (v: Record<string, unknown> | null) =>
  JSON.stringify(
    Object.entries(v ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
const sameJson = (
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
) => sortedJson(a) === sortedJson(b);

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
        sameJson(e.terminationRaw, d.terminationRaw)
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
