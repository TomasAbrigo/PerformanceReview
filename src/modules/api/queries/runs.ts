import { and, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { IngestCounts, IngestReject } from "@/db/schema";
import { rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import type { RunStatus } from "@/modules/ingest/run-status";
import { encodeCursor, pageOf, type Page } from "../pagination";
import { afterTsId, iso } from "./shared";

export type RunRow = {
  id: string;
  sourceSystem: string | null;
  adapter: string | null;
  entity: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  counts: Partial<IngestCounts>;
  /** Entries in the reject log. */
  issueCount: number;
  error: string | null;
};

export type RunDetail = RunRow & {
  params: Record<string, unknown>;
  rejects: IngestReject[];
  rawRecordCount: number;
};

export type ListRunsInput = {
  limit: number;
  cursor?: string | null;
  source?: string;
  entity?: string;
  status?: RunStatus;
};

const COLUMNS = sql`
  r.id, r.source_system as "sourceSystem", r.adapter, r.entity,
  r.status::text as status, ${iso("r.started_at")} as "startedAt",
  ${iso("r.finished_at")} as "finishedAt", coalesce(r.counts, '{}'::jsonb) as counts,
  (case when jsonb_typeof(r.rejects) = 'array'
    then jsonb_array_length(r.rejects) else 0 end) as "issueCount",
  r.error
`;

/** Runs, newest first by (started_at, id). */
export async function listRunRows(
  db: DbOrTx,
  { limit, cursor, source, entity, status }: ListRunsInput,
): Promise<Page<RunRow>> {
  const rows = rowsOf<RunRow>(
    await db.execute(sql`
      select ${COLUMNS}
      from ingest_run r
      where ${
        and(
          afterTsId("r.started_at", "r.id", cursor, "desc"),
          source ? sql`r.source_system = ${source}` : undefined,
          entity ? sql`r.entity = ${entity}` : undefined,
          status ? sql`r.status = ${status}::ingest_run_status` : undefined,
        ) ?? sql`true`
      }
      order by r.started_at desc, r.id desc
      limit ${limit + 1}
    `),
  );
  return pageOf(rows, limit, (r) => encodeCursor([r.startedAt, r.id]));
}

/** One run with params, reject log and the number of raw records it landed; null if unknown. */
export async function getRunDetail(
  db: DbOrTx,
  id: string,
): Promise<RunDetail | null> {
  if (!isUuid(id)) return null;
  const [row] = rowsOf<
    RunRow & {
      params: Record<string, unknown> | null;
      rejects: IngestReject[] | null;
      rawRecordCount: number;
    }
  >(
    await db.execute(sql`
      select ${COLUMNS}, r.params, r.rejects,
        (select count(*)::int from raw_record rr where rr.run_id = r.id)
          as "rawRecordCount"
      from ingest_run r
      where r.id = ${id}::uuid
    `),
  );
  if (!row) return null;
  return {
    ...row,
    params: row.params ?? {},
    rejects: row.rejects ?? [],
  };
}
