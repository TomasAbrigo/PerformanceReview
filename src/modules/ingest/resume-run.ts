import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  ingestRun,
  rawRecord,
  reviewCycle,
  type IngestCounts,
  type IngestReject,
  type SourceSystem,
} from "@/db/schema";
import { errorMessage } from "@/lib/log";
import { createImportedCycle } from "@/modules/import-history/cycles";
import { decisionOf } from "@/modules/import-history/decision";
import { questionsOfRun } from "@/modules/import-history/run-profile";
import { isUuid } from "@/lib/uuid";
import { handlerFor, type EntityHandler } from "./handlers";
import type { IngestEntity } from "./types";

/** Where the rows of a `needs_decision` run go: a cycle, or a proposed one. */
export type ResumeTarget = { cycleId: string } | { create: string };

export type ResumeErrorCode =
  | "not_found"
  /** The run is not waiting for a decision (already resumed, or never was). */
  | "not_waiting"
  /** The proposal to create is not one the run offered. */
  | "unknown_proposal"
  /** The chosen cycle does not exist. */
  | "unknown_cycle";

export class ResumeError extends Error {
  constructor(
    readonly code: ResumeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ResumeError";
  }
}

/**
 * Finishes a run that stopped in `needs_decision`: its held-back rows (found
 * again in raw_record by source id and hash) go through the entity's handler
 * once more with the chosen cycle forced (`ctx.forcedCycleId`), then the
 * handler's `finish` runs and the run ends `succeeded`. Rows already written
 * by the first pass are not touched. Claiming the run first (status
 * `running`) makes a second, concurrent resume fail with `not_waiting`.
 */
export async function resumeImportRun(
  db: DbOrTx,
  runId: string,
  target: ResumeTarget,
): Promise<{ runId: string; counts: IngestCounts; cycleId: string }> {
  const [run] = await db
    .update(ingestRun)
    .set({ status: "running" })
    .where(and(eq(ingestRun.id, runId), eq(ingestRun.status, "needs_decision")))
    .returning();
  if (!run) {
    const [exists] = await db
      .select({ id: ingestRun.id })
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    throw exists
      ? new ResumeError(
          "not_waiting",
          `Run ${runId} is not waiting for a decision`,
        )
      : new ResumeError("not_found", `No run ${runId}`);
  }
  const decision = decisionOf(run.params);
  const counts = { ...(run.counts ?? {}) } as IngestCounts;
  const rejects: IngestReject[] = [...(run.rejects ?? [])];
  try {
    if (!decision) throw new Error(`Run ${runId} has no stored decision`);
    let cycleId: string;
    if ("create" in target) {
      const proposal = decision.proposals.find((p) => p.name === target.create);
      if (!proposal) {
        throw new ResumeError(
          "unknown_proposal",
          `Run ${runId} did not propose a cycle named "${target.create}"`,
        );
      }
      cycleId = (await createImportedCycle(db, { ...proposal, runId })).id;
    } else {
      const [cycle] = isUuid(target.cycleId)
        ? await db
            .select({ id: reviewCycle.id })
            .from(reviewCycle)
            .where(eq(reviewCycle.id, target.cycleId))
        : [];
      if (!cycle) {
        throw new ResumeError("unknown_cycle", `No cycle ${target.cycleId}`);
      }
      cycleId = cycle.id;
    }

    const handler = handlerFor(
      run.entity as IngestEntity,
      false,
    ) as EntityHandler<unknown>;
    const source = run.sourceSystem as SourceSystem;
    const cache = new Map<string, unknown>();
    const questions = await questionsOfRun(db, runId);
    counts.deferred = 0;
    for (const pending of decision.pending) {
      const [record] = await db
        .select({ payload: rawRecord.payload })
        .from(rawRecord)
        .where(
          and(
            eq(rawRecord.sourceSystem, source),
            eq(rawRecord.entity, run.entity),
            eq(rawRecord.sourceId, pending.sourceId),
            eq(rawRecord.payloadHash, pending.hash),
          ),
        );
      const staged = record && handler.schema.safeParse(record.payload);
      if (!staged || !staged.success) {
        counts.rejected = (counts.rejected ?? 0) + 1;
        rejects.push({
          sourceId: pending.sourceId,
          reason: "The held-back row is no longer readable",
        });
        continue;
      }
      const outcome = await db.transaction((tx) =>
        handler.upsert(tx, staged.data, {
          source,
          hash: pending.hash,
          runId,
          sourceId: pending.sourceId,
          payload: record.payload,
          cache,
          forcedCycleId: cycleId,
          ...(questions ? { questions } : {}),
        }),
      );
      counts[outcome.result] = (counts[outcome.result] ?? 0) + 1;
      for (const reason of outcome.rejects) {
        rejects.push({ sourceId: pending.sourceId, reason });
      }
    }
    // finish recomputes the run's reviewer mismatches over all its rows (the
    // first pass's too): drop what the first finish counted and logged.
    if (counts.mismatches !== undefined) counts.mismatches = 0;
    const kept = rejects.filter((r) => r.code !== "reviewer_mismatch");
    rejects.splice(0, rejects.length, ...kept);
    const extra = handler.finish
      ? await handler.finish(db, {
          source,
          runId,
          seen: new Set(),
          cache,
          reject: (reject) => rejects.push(reject),
        })
      : {};
    for (const [k, v] of Object.entries(extra) as [
      keyof IngestCounts,
      number,
    ][]) {
      counts[k] = (counts[k] ?? 0) + v;
    }
    await db
      .update(ingestRun)
      .set({
        status: "succeeded",
        finishedAt: new Date(),
        counts,
        rejects,
        params: {
          ...run.params,
          decision: {
            ...decision,
            resolved: { cycleId, at: new Date().toISOString() },
          },
        },
      })
      .where(eq(ingestRun.id, runId));
    return { runId, counts, cycleId };
  } catch (error) {
    // A choice that was not offered leaves the run waiting; anything else
    // ends it in error, like any failed run.
    const waiting = error instanceof ResumeError;
    await db
      .update(ingestRun)
      .set(
        waiting
          ? { status: "needs_decision" }
          : { status: "error", error: errorMessage(error), counts, rejects },
      )
      .where(eq(ingestRun.id, runId));
    throw error;
  }
}
