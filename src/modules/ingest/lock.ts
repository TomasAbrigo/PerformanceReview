import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";

/**
 * Runs `fn` while holding a Postgres advisory lock named `key`, waiting if
 * another process holds it. Two overlapping runs of the same entity (a slow
 * cron job and the next one, or two people at once) would race on the same
 * rows; this makes them take turns.
 *
 * The lock is a transaction-level one (`pg_advisory_xact_lock`) taken in a
 * transaction that stays open while `fn` runs on other connections of the
 * same pool. Unlike a session lock it needs no connection of its own and
 * survives a transaction pooler (Supabase port 6543, pgbouncer), which can
 * hand the next statement to a different backend; the transaction pins one.
 * Postgres releases it on commit, rollback or if the process dies. Keep the
 * pool at 2 connections or more, and `idle_in_transaction_session_timeout`
 * (unset by default) above the longest run.
 */
export async function withAdvisoryLock<T>(
  db: Database,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
    return fn();
  });
}
