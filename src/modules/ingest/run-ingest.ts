import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  employment,
  ingestRun,
  person,
  rawRecord,
  sourceIdentity,
  type IdentityKind,
  type IngestCounts,
  type IngestReject,
  type SourceSystem,
} from "@/db/schema";
import { stagedEmployeeSchema, type StagedEmployee } from "./staging";
import type { Entity, SourceAdapter } from "./types";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type RunIngestInput = {
  adapter: SourceAdapter;
  entity: Entity;
  db: Database;
  params?: Record<string, unknown>;
};

export type RunIngestResult = { runId: string; counts: IngestCounts };

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
  tx: Tx,
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
      ),
    );
  return match?.personId ?? null;
}

/** Ensures the person's current identity of `kind` is `value`, closing the old one. */
async function syncIdentity(
  tx: Tx,
  personId: string,
  source: SourceSystem,
  kind: IdentityKind,
  value: string | null,
  now: Date,
) {
  const current = await tx
    .select()
    .from(sourceIdentity)
    .where(
      and(
        eq(sourceIdentity.personId, personId),
        eq(sourceIdentity.sourceSystem, source),
        eq(sourceIdentity.kind, kind),
        isNull(sourceIdentity.validTo),
      ),
    );
  if (current.some((c) => c.value === value)) return;
  for (const c of current) {
    await tx
      .update(sourceIdentity)
      .set({ validTo: now, updatedAt: now })
      .where(eq(sourceIdentity.id, c.id));
  }
  if (value === null) return;
  await tx
    .insert(sourceIdentity)
    .values({ personId, sourceSystem: source, kind, value, validFrom: now })
    // Same value already held by another person: left to issue #5's queue.
    .onConflictDoNothing();
}

async function syncIdentities(
  tx: Tx,
  personId: string,
  source: SourceSystem,
  staged: StagedEmployee,
  now: Date,
) {
  await syncIdentity(tx, personId, source, "bamboo_id", staged.sourceId, now);
  await syncIdentity(
    tx,
    personId,
    source,
    "employee_number",
    staged.employeeNumber,
    now,
  );
  await syncIdentity(tx, personId, source, "work_email", staged.workEmail, now);
}

async function upsertEmployee(
  tx: Tx,
  source: SourceSystem,
  staged: StagedEmployee,
  hash: string,
  runId: string,
): Promise<"inserted" | "updated" | "unchanged"> {
  const now = new Date();
  const [existing] = await tx
    .select()
    .from(employment)
    .where(
      and(
        eq(employment.sourceSystem, source),
        eq(employment.sourceId, staged.sourceId),
      ),
    );

  if (existing?.payloadHash === hash) return "unchanged";

  const employmentValues = {
    hireDate: staged.hireDate,
    terminationDate: staged.terminationDate,
    status: staged.status,
    ingestRunId: runId,
    payloadHash: hash,
    updatedAt: now,
  };

  if (existing) {
    await tx
      .update(employment)
      .set(employmentValues)
      .where(eq(employment.id, existing.id));
    await tx
      .update(person)
      .set({
        displayName: staged.displayName,
        workEmail: staged.workEmail,
        updatedAt: now,
      })
      .where(eq(person.id, existing.personId));
    await syncIdentities(tx, existing.personId, source, staged, now);
    return "updated";
  }

  let personId = await resolvePerson(tx, source, staged);
  if (!personId) {
    const [created] = await tx
      .insert(person)
      .values({ displayName: staged.displayName, workEmail: staged.workEmail })
      .returning({ id: person.id });
    personId = created.id;
  }
  await syncIdentities(tx, personId, source, staged, now);
  await tx.insert(employment).values({
    ...employmentValues,
    personId,
    sourceSystem: source,
    sourceId: staged.sourceId,
  });
  return "inserted";
}

/** raw → staged (zod) → domain upsert, recorded as one ingest_run. */
export async function runIngest({
  adapter,
  entity,
  db,
  params = {},
}: RunIngestInput): Promise<RunIngestResult> {
  const source = adapter.source;
  const [run] = await db
    .insert(ingestRun)
    .values({
      sourceSystem: source,
      adapter: adapter.name,
      params: { entity, ...params },
      status: "running",
    })
    .returning({ id: ingestRun.id });

  const counts: IngestCounts = {
    read: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
  };
  const rejects: IngestReject[] = [];

  try {
    for await (const record of adapter.extract({}, entity)) {
      counts.read++;
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

      const outcome = await db.transaction((tx) =>
        upsertEmployee(tx, source, parsed.data, hash, run.id),
      );
      counts[outcome]++;
    }

    await db
      .update(ingestRun)
      .set({ status: "succeeded", finishedAt: new Date(), counts, rejects })
      .where(eq(ingestRun.id, run.id));
  } catch (err) {
    await db
      .update(ingestRun)
      .set({
        status: "failed",
        finishedAt: new Date(),
        counts,
        rejects,
        error: (err as Error).message,
      })
      .where(eq(ingestRun.id, run.id));
    throw err;
  }

  return { runId: run.id, counts };
}
