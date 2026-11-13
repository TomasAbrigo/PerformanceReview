import { createHash } from "node:crypto";
import { and, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  employment,
  ingestRun,
  person,
  rawRecord,
  sourceIdentity,
  type Employment,
  type IdentityKind,
  type IngestCounts,
  type IngestReject,
  type SourceSystem,
} from "@/db/schema";
import { stagedEmployeeSchema, type StagedEmployee } from "./staging";
import { advanceSyncState } from "./sync-state";
import type { Entity, SourceAdapter } from "./types";

export type RunIngestInput = {
  adapter: SourceAdapter;
  entity: Entity;
  db: DbOrTx;
  params?: Record<string, unknown>;
  /**
   * Incremental extraction: only what changed since this watermark. A partial
   * extraction never soft-deletes what it did not return.
   */
  since?: string;
};

export type RunIngestResult = { runId: string; counts: IngestCounts };

/**
 * A run that ended in status `error`. The run row (with the counts reached so
 * far and the message) is already saved; `runId` points at it.
 */
export class IngestRunError extends Error {
  constructor(
    message: string,
    readonly runId: string,
    readonly counts: IngestCounts,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IngestRunError";
  }
}

/** JSON with sorted keys, so key order never changes the hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const payloadHash = (payload: unknown) =>
  createHash("sha256").update(canonical(payload)).digest("hex");

/**
 * Identity resolution seam. Minimal for now: match on the source's own id
 * (bamboo_id). Matching by employee_number / email and the manual-review
 * queue belong to the identity module (issue #5).
 */
export async function resolvePerson(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedEmployee,
): Promise<string | null> {
  const [match] = await tx
    .select({ personId: sourceIdentity.personId })
    .from(sourceIdentity)
    .where(
      and(
        eq(sourceIdentity.sourceSystem, source),
        eq(sourceIdentity.kind, "bamboo_id"),
        eq(sourceIdentity.value, staged.sourceId),
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

type Outcome = {
  result: "inserted" | "updated" | "unchanged";
  conflicts: string[];
};

async function upsertEmployee(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedEmployee,
  hash: string,
  runId: string,
): Promise<Outcome> {
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
    ingestRunId: runId,
    payloadHash: hash,
    updatedAt: now,
    deletedAt: null,
  };

  let personId =
    periods[0]?.personId ?? (await resolvePerson(tx, source, staged));
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

/**
 * raw → staged (zod) → domain upsert, recorded as one ingest_run. Extractions
 * are full unless `since` is given: employments not seen in a successful full
 * run are soft-deleted.
 *
 * Every record commits on its own, so the watermark in `sync_state` only
 * advances once the whole run is done, in the same transaction that marks it
 * `succeeded`. A run that throws ends in `error` (with `finished_at`) and
 * leaves the previous watermark untouched; re-running is safe (idempotent).
 */
export async function runIngest({
  adapter,
  entity,
  db,
  params = {},
  since,
}: RunIngestInput): Promise<RunIngestResult> {
  const source = adapter.source;
  const [run] = await db
    .insert(ingestRun)
    .values({
      sourceSystem: source,
      adapter: adapter.name,
      params: { entity, ...params, ...(since ? { since } : {}) },
      status: "running",
    })
    .returning({ id: ingestRun.id, startedAt: ingestRun.startedAt });

  const counts: IngestCounts = {
    read: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    deleted: 0,
  };
  const rejects: IngestReject[] = [];
  const seen = new Set<string>();

  try {
    for await (const record of adapter.extract({ since }, entity)) {
      counts.read++;
      seen.add(record.sourceId);
      const hash = payloadHash(record.payload);
      await db
        .insert(rawRecord)
        .values({
          runId: run.id,
          sourceSystem: source,
          entity,
          sourceId: record.sourceId,
          payload: record.payload,
          payloadHash: hash,
          extractedAt: record.extractedAt,
        })
        .onConflictDoNothing();

      const parsed = stagedEmployeeSchema.safeParse(record.payload);
      if (!parsed.success) {
        counts.rejected++;
        rejects.push({
          sourceId: record.sourceId,
          reason: parsed.error.issues.map((i) => i.message).join("; "),
        });
        continue;
      }

      const { result, conflicts } = await db.transaction((tx) =>
        upsertEmployee(tx, source, parsed.data, hash, run.id),
      );
      counts[result]++;
      for (const reason of conflicts) {
        rejects.push({ sourceId: record.sourceId, reason });
      }
    }

    // Guards: an empty extraction is far more likely a broken source than a
    // company with nobody left, and an incremental one only lists what changed.
    if (seen.size > 0 && since === undefined) {
      const now = new Date();
      const deleted = await db
        .update(employment)
        .set({ deletedAt: now, updatedAt: now, ingestRunId: run.id })
        .where(
          and(
            eq(employment.sourceSystem, source),
            isNull(employment.deletedAt),
            notInArray(employment.sourceId, [...seen]),
          ),
        )
        .returning({ id: employment.id });
      counts.deleted = deleted.length;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(ingestRun)
        .set({ status: "succeeded", finishedAt: new Date(), counts, rejects })
        .where(eq(ingestRun.id, run.id));
      await advanceSyncState(tx, {
        sourceSystem: source,
        entity,
        // Start of the extraction: changes made while it ran are re-read next time.
        watermark: (run.startedAt ?? new Date()).toISOString(),
        runId: run.id,
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(ingestRun)
      .set({
        status: "error",
        finishedAt: new Date(),
        counts,
        rejects,
        error: message,
      })
      .where(eq(ingestRun.id, run.id));
    throw new IngestRunError(message, run.id, counts, { cause: err });
  }

  return { runId: run.id, counts };
}
