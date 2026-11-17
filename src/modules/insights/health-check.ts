import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";

export type HealthCheckLanding = {
  /** Successful imports with the cap-health-check profile. */
  runs: number;
  /** Distinct files among them (by content hash). */
  files: number;
  /** Rows landed in raw_record (each distinct row once). */
  rows: number;
  lastLandedAt: Date | null;
};

/**
 * What has been landed of CAP's health check (entity `health_check`): its
 * format is still undefined, so this is all the app knows about it. Counts
 * only, no content.
 */
export async function healthCheckLanding(
  db: DbOrTx,
): Promise<HealthCheckLanding> {
  const [runs] = await db.execute<{
    runs: number;
    files: number;
    last: string | null;
  }>(sql`
    select count(*)::int as runs,
           count(distinct coalesce(params ->> 'sha256', id::text))::int as files,
           max(coalesce(finished_at, started_at))::text as last
    from ingest_run where entity = 'health_check' and status = 'succeeded'`);
  const [rows] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from raw_record where entity = 'health_check'`,
  );
  return {
    runs: runs.runs,
    files: runs.files,
    rows: rows.n,
    lastLandedAt: runs.last ? new Date(runs.last) : null,
  };
}
