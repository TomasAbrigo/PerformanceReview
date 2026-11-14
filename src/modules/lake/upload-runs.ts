import { and, eq, gte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ingestRun } from "@/db/schema";

/**
 * Fails the runs of an upload that were left `running`: the safety net for a
 * worker that was killed before it could say so (the worker itself marks its
 * run as failed when it is told to stop, see scripts/ingest-upload.ts). Only
 * runs of the file adapter, for that content, started at or after `since`.
 * Returns how many it failed. No DuckDB here, so the app can call it.
 */
export async function markUploadRunsFailed(
  db: DbOrTx,
  { sha256, since, message }: { sha256: string; since: Date; message: string },
): Promise<number> {
  const marked = await db
    .update(ingestRun)
    .set({ status: "error", finishedAt: new Date(), error: message })
    .where(
      and(
        eq(ingestRun.status, "running"),
        eq(ingestRun.adapter, "file"),
        sql`${ingestRun.params}->>'sha256' = ${sha256}`,
        gte(ingestRun.startedAt, since),
      ),
    )
    .returning({ id: ingestRun.id });
  return marked.length;
}
