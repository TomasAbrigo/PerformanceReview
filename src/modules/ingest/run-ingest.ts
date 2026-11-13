import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  ingestRun,
  rawRecord,
  type IngestCounts,
  type IngestReject,
} from "@/db/schema";
import { payloadHash } from "./canonical";
import { handlerFor } from "./handlers";
import type { ExtractContext, IngestEntity, SourceAdapter } from "./types";

export { canonical, payloadHash } from "./canonical";
export { resolvePerson } from "./employee";

export type RunIngestInput = {
  adapter: SourceAdapter;
  entity: IngestEntity;
  db: DbOrTx;
  /**
   * Landing mode: only write raw_record (and the run), no staging or domain
   * upsert. Required for entities without a domain handler yet.
   */
  landing?: boolean;
  params?: Record<string, unknown>;
  /** Passed to the adapter (e.g. `since` for an incremental extraction). */
  extract?: ExtractContext;
};

export type RunIngestResult = { runId: string; counts: IngestCounts };

/**
 * raw → staged (zod) → domain upsert, recorded as one ingest_run. What each
 * entity does lives in `entityHandlers` (handlers.ts).
 */
export async function runIngest({
  adapter,
  entity,
  db,
  landing = false,
  params = {},
  extract = {},
}: RunIngestInput): Promise<RunIngestResult> {
  const handler = handlerFor(entity, landing); // fails before opening a run
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
    ...("landing" in handler ? {} : handler.counts),
  };
  const rejects: IngestReject[] = [];
  const seen = new Set<string>();
  const cache = new Map<string, unknown>();

  try {
    for await (const record of adapter.extract(extract, entity)) {
      counts.read++;
      if ("rejected" in record) {
        counts.rejected++;
        rejects.push({ sourceId: record.sourceId, reason: record.reason });
        continue;
      }
      seen.add(record.sourceId);
      const hash = payloadHash(record.payload);
      const landed = await db
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
        .onConflictDoNothing()
        .returning({ id: rawRecord.id });

      if ("landing" in handler) {
        counts[landed.length ? "inserted" : "unchanged"]++;
        continue;
      }

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
        handler.upsert(tx, staged.data, { source, hash, runId: run.id, cache }),
      );
      counts[outcome.result]++;
      addCounts(counts, outcome.counts);
      for (const reason of outcome.rejects) {
        rejects.push({ sourceId: record.sourceId, reason });
      }
    }

    // Incremental extractions (since) never see everything: skip finish.
    if (!("landing" in handler) && handler.finish && !extract.since) {
      addCounts(
        counts,
        await handler.finish(db, { source, runId: run.id, seen }),
      );
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

function addCounts(into: IngestCounts, extra: Partial<IngestCounts> = {}) {
  for (const [k, v] of Object.entries(extra) as [
    keyof IngestCounts,
    number,
  ][]) {
    into[k] = (into[k] ?? 0) + v;
  }
}
