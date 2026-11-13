import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { SourceSystem } from "@/db/schema";

/**
 * Serializes whoever decides what a source record becomes: an ingest creating
 * or queueing it, and a reviewer resolving its issue. Held until the
 * transaction ends. Always take it before any row lock on the issue, so the
 * two paths cannot deadlock.
 */
export async function lockSourceRecord(
  tx: DbOrTx,
  source: SourceSystem,
  entity: string,
  sourceId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`identity:${source}:${entity}:${sourceId}`}, 0))`,
  );
}
