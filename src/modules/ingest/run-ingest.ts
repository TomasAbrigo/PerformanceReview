import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  ingestRun,
  rawRecord,
  type IngestCounts,
  type IngestReject,
} from "@/db/schema";
import { payloadHash } from "./canonical";
import { entityHandlers } from "./handlers";
import { advanceSyncState } from "./sync-state";
import type { Entity, ExtractContext, SourceAdapter } from "./types";

export { canonical, payloadHash } from "./canonical";
export { resolvePerson } from "./employee";

export type RunIngestInput = {
  adapter: SourceAdapter;
  entity: Entity;
  db: DbOrTx;
  params?: Record<string, unknown>;
  /** Passed to the adapter (e.g. `since` for an incremental extraction). */
  extract?: ExtractContext;
  /**
   * employee: what to do with a record that matches nobody and resembles
   * nobody: create the person (default) or queue it for review.
   */
  unmatched?: "create" | "queue";
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

/**
 * raw → staged (zod) → domain upsert, recorded as one ingest_run. What each
 * entity does lives in `entityHandlers` (handlers.ts). Throws before opening a
 * run for an entity without a handler.
 *
 * Every record commits on its own, so the watermark in `sync_state` (per
 * source, adapter and entity) only advances once the whole run is done, in the
 * same transaction that marks it `succeeded`. A run that throws ends in
 * `error` (with `finished_at`) as an `IngestRunError` and leaves the previous
 * watermark untouched; re-running is safe (idempotent). An incremental run
 * (`extract.since`) never runs the handler's `finish` (e.g. soft-deletes).
 */
export async function runIngest({
  adapter,
  entity,
  db,
  params = {},
  extract = {},
  unmatched,
}: RunIngestInput): Promise<RunIngestResult> {
  const handler = entityHandlers[entity];
  if (!handler) throw new Error(`Unsupported entity ${entity}`);
  const source = adapter.source;
  const [run] = await db
    .insert(ingestRun)
    .values({
      sourceSystem: source,
      adapter: adapter.name,
      entity,
      params: {
        entity,
        ...params,
        ...(extract.since ? { since: extract.since } : {}),
      },
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
    ...handler.counts,
  };
  const rejects: IngestReject[] = [];
  const seen = new Set<string>();
  const cache = new Map<string, unknown>();

  try {
    for await (const record of adapter.extract(extract, entity)) {
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

      const staged = handler.schema.safeParse(record.payload);
      if (!staged.success) {
        counts.rejected++;
        rejects.push({
          sourceId: record.sourceId,
          reason: staged.error.issues.map((i) => i.message).join("; "),
        });
        continue;
      }
      const outcome = await db.transaction((tx) =>
        handler.upsert(tx, staged.data, {
          source,
          hash,
          runId: run.id,
          payload: record.payload,
          unmatched,
          cache,
        }),
      );
      counts[outcome.result] = (counts[outcome.result] ?? 0) + 1;
      addCounts(counts, outcome.counts);
      for (const reason of outcome.rejects) {
        rejects.push({ sourceId: record.sourceId, reason });
      }
    }

    // Incremental extractions (since) never see everything: skip finish.
    if (handler.finish && !extract.since) {
      addCounts(
        counts,
        await handler.finish(db, { source, runId: run.id, seen }),
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(ingestRun)
        .set({ status: "succeeded", finishedAt: new Date(), counts, rejects })
        .where(eq(ingestRun.id, run.id));
      await advanceSyncState(tx, {
        sourceSystem: source,
        adapter: adapter.name,
        entity,
        // Start of the extraction: changes made while it ran are re-read next time.
        watermark: run.startedAt.toISOString(),
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

function addCounts(into: IngestCounts, extra: Partial<IngestCounts> = {}) {
  for (const [k, v] of Object.entries(extra) as [
    keyof IngestCounts,
    number,
  ][]) {
    into[k] = (into[k] ?? 0) + v;
  }
}
