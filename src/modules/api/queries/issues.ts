import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type {
  IdentityCandidate,
  IdentityIssueReason,
  IdentityIssueStatus,
  IdentityResolution,
} from "@/db/schema";
import { rowsOf } from "@/lib/sql";
import { encodeCursor, pageOf, type Page } from "../pagination";
import { afterTsId, and, iso } from "./shared";

export type IssueRow = {
  id: string;
  sourceSystem: string;
  entity: string;
  sourceId: string;
  reason: IdentityIssueReason;
  status: IdentityIssueStatus;
  ingestRunId: string;
  candidates: IdentityCandidate[];
  payload: unknown;
  resolution: IdentityResolution | null;
  createdAt: string;
  resolvedAt: string | null;
};

/** Identity-queue issues, oldest first by (created_at, id), optionally of one status. */
export async function listIssueRows(
  db: DbOrTx,
  {
    limit,
    cursor,
    status,
  }: { limit: number; cursor?: string | null; status?: IdentityIssueStatus },
): Promise<Page<IssueRow>> {
  const rows = rowsOf<IssueRow>(
    await db.execute(sql`
      select i.id, i.source_system::text as "sourceSystem", i.entity,
        i.source_id as "sourceId", i.reason::text as reason,
        i.status::text as status, i.ingest_run_id as "ingestRunId",
        i.candidates, i.payload, i.resolution,
        ${iso("i.created_at")} as "createdAt", ${iso("i.resolved_at")} as "resolvedAt"
      from identity_match_issue i
      where ${and([
        sql`true`,
        afterTsId("i.created_at", "i.id", cursor),
        status ? sql`i.status = ${status}::identity_issue_status` : undefined,
      ])}
      order by i.created_at, i.id
      limit ${limit + 1}
    `),
  );
  return pageOf(rows, limit, (r) => encodeCursor([r.createdAt, r.id]));
}
