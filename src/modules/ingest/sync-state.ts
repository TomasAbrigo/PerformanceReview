import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { syncState, type SourceSystem, type SyncState } from "@/db/schema";

export type SyncKey = { sourceSystem: SourceSystem; entity: string };

/** The stored watermark/cursor for one entity of one source, if any run has succeeded. */
export async function getSyncState(
  db: DbOrTx,
  { sourceSystem, entity }: SyncKey,
): Promise<SyncState | null> {
  const [row] = await db
    .select()
    .from(syncState)
    .where(
      and(
        eq(syncState.sourceSystem, sourceSystem),
        eq(syncState.entity, entity),
      ),
    );
  return row ?? null;
}

export type AdvanceSyncStateInput = SyncKey & {
  watermark: string | null;
  cursor?: string | null;
  /** The successful run that produced this watermark. */
  runId: string;
};

/**
 * Records that `runId` succeeded and the next extraction can start at
 * `watermark`. Call it only once everything the run wrote has committed (ideally
 * in the same transaction that marks the run succeeded), and never for a failed
 * run: a failure must leave the previous watermark intact.
 */
export async function advanceSyncState(
  db: DbOrTx,
  {
    sourceSystem,
    entity,
    watermark,
    cursor = null,
    runId,
  }: AdvanceSyncStateInput,
): Promise<void> {
  const values = {
    watermark,
    cursor,
    lastSuccessAt: new Date(),
    lastRunId: runId,
  };
  await db
    .insert(syncState)
    .values({ sourceSystem, entity, ...values })
    .onConflictDoUpdate({
      target: [syncState.sourceSystem, syncState.entity],
      set: values,
    });
}
