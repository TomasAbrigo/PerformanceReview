import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  employment,
  ingestRun,
  rawRecord,
  type Employment,
  type IngestCounts,
  type IngestReject,
  type SourceSystem,
} from "@/db/schema";
// Direct file imports (not the identity barrel): the identity service imports
// this file back, and a barrel would close the cycle.
import { toCandidates } from "@/modules/identity/candidates";
import { lockSourceRecord } from "@/modules/identity/lock";
import {
  closeOpenIssue,
  hasOpenIssue,
  openIssueSourceIds,
  raiseIssue,
} from "@/modules/identity/raise";
import {
  resolvePerson,
  type ResolveContext,
} from "@/modules/identity/resolve-person";
import {
  createPerson,
  isCurrentStint,
  syncIdentities,
  updatePerson,
} from "@/modules/identity/sync";
import { payloadHash } from "./hash";
import { stagedEmployeeSchema, type StagedEmployee } from "./staging";
import type { Entity, SourceAdapter } from "./types";

export { payloadHash };

export type RunIngestInput = {
  adapter: SourceAdapter;
  entity: Entity;
  db: DbOrTx;
  params?: Record<string, unknown>;
  /**
   * What to do with a record that matches nobody and resembles nobody:
   * create the person (default) or queue it for review.
   */
  unmatched?: "create" | "queue";
};

export type RunIngestResult = { runId: string; counts: IngestCounts };

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

/** A reviewer's choice for a record that was held in the identity queue. */
export type Decision =
  { action: "link"; personId: string } | { action: "create" };

export type UpsertContext = ResolveContext & {
  decision?: Decision;
  /**
   * Source ids with an open issue when the run started. Saves a lookup per
   * record; without it the database is asked.
   */
  openIssues?: ReadonlySet<string>;
};

/**
 * `issue`: the record was held in the identity queue, or applied except for
 * an identifier another person holds (flagged as a conflict).
 * `ignored`: held back because a reviewer already ignored this exact record.
 */
export type Outcome = {
  result: "inserted" | "updated" | "unchanged" | "issue" | "ignored";
  personId: string | null;
};

/** Domain upsert of one staged employee; also what resolving an issue runs. */
export async function upsertEmployee(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedEmployee,
  ctx: UpsertContext,
): Promise<Outcome> {
  const now = new Date();
  const loadPeriods = () =>
    tx
      .select()
      .from(employment)
      .where(
        and(
          eq(employment.sourceSystem, source),
          eq(employment.sourceId, staged.sourceId),
        ),
      )
      .orderBy(sql`${employment.hireDate} desc nulls last`);
  const openIssue = () => hasOpenIssue(tx, source, "employee", staged.sourceId);

  let periods = await loadPeriods();
  // A reviewer settling the record's issue is the only thing that can change
  // what we decide here, so coordinate with them when the record has no
  // employment yet or is waiting in the queue. (A resolution already holds
  // the lock in its own transaction.)
  let waiting = ctx.decision
    ? false
    : ctx.openIssues
      ? ctx.openIssues.has(staged.sourceId)
      : await openIssue();
  if (!ctx.decision && (periods.length === 0 || waiting)) {
    await lockSourceRecord(tx, source, "employee", staged.sourceId);
    periods = await loadPeriods();
    waiting = await openIssue();
  }
  const target = targetPeriod(periods, staged);

  // An unchanged row is skipped, unless its open issue may be settled by now
  // (the holder of a conflicting identifier may have let go of it).
  if (
    target !== "new" &&
    target.payloadHash === ctx.hash &&
    !target.deletedAt &&
    !waiting
  ) {
    return { result: "unchanged", personId: target.personId };
  }

  const employmentValues = {
    hireDate: staged.hireDate,
    terminationDate: staged.terminationDate,
    status: staged.status,
    ingestRunId: ctx.runId,
    payloadHash: ctx.hash,
    updatedAt: now,
    deletedAt: null,
  };

  let personId = periods[0]?.personId;
  if (!personId) {
    const resolved = !ctx.decision
      ? await resolvePerson(tx, source, staged, ctx)
      : ctx.decision.action === "link"
        ? { personId: ctx.decision.personId }
        : { personId: await createPerson(tx, staged) };
    if ("issueId" in resolved) return { result: "issue", personId: null };
    // A reviewer already chose to ignore exactly this payload.
    if ("ignoredIssueId" in resolved) {
      return { result: "ignored", personId: null };
    }
    personId = resolved.personId;
  }
  const current = await isCurrentStint(tx, personId, staged);
  if (current) await updatePerson(tx, personId, staged, now);
  const conflicts = await syncIdentities(
    tx,
    personId,
    source,
    staged,
    now,
    current,
  );

  let result: Outcome["result"];
  if (target === "new") {
    await tx.insert(employment).values({
      ...employmentValues,
      personId,
      sourceSystem: source,
      sourceId: staged.sourceId,
    });
    result = periods.length ? "updated" : "inserted";
  } else {
    await tx
      .update(employment)
      .set(employmentValues)
      .where(eq(employment.id, target.id));
    result = "updated";
  }

  const row = {
    source,
    entity: "employee" as const,
    sourceId: staged.sourceId,
  };
  if (conflicts.length === 0) {
    // It applies cleanly now: whatever was waiting for it is moot.
    if (waiting) {
      await closeOpenIssue(tx, row, { action: "link", personId, auto: true });
    }
    return { result, personId };
  }
  const raised = await raiseIssue(tx, {
    ...row,
    runId: ctx.runId,
    payload: ctx.payload,
    hash: ctx.hash,
    reason: "conflict",
    candidates: toCandidates([
      [personId, "bamboo_id"],
      ...conflicts.map((c): [string, typeof c.kind] => [
        c.holderPersonId,
        c.kind,
      ]),
    ]),
  });
  // A conflict a reviewer already waved through is not raised again.
  return { result: "ignoredIssueId" in raised ? result : "issue", personId };
}

/**
 * raw → staged (zod) → domain upsert, recorded as one ingest_run. Extractions
 * are full: employments not seen in a successful run are soft-deleted.
 */
export async function runIngest({
  adapter,
  entity,
  db,
  params = {},
  unmatched,
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
    deleted: 0,
    issues: 0,
    ignored: 0,
  };
  const rejects: IngestReject[] = [];
  const seen = new Set<string>();
  const openIssues = await openIssueSourceIds(db, source, entity);

  try {
    for await (const record of adapter.extract({}, entity)) {
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

      const { result } = await db.transaction((tx) =>
        upsertEmployee(tx, source, parsed.data, {
          runId: run.id,
          hash,
          payload: record.payload,
          unmatched,
          openIssues,
        }),
      );
      counts[result === "issue" ? "issues" : result]++;
    }

    // Guard: an empty extraction is far more likely a broken source than a
    // company with nobody left, so it never deletes.
    if (seen.size > 0) {
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
