import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  ingestRun,
  rawRecord,
  type IngestCounts,
  type IngestReject,
} from "@/db/schema";
import { isRunStatus, type RunStatus } from "./run-status";

export type RunListFilters = {
  /** `ingest_run.source_system`, e.g. "bamboo_api". */
  source?: string;
  /** `ingest_run.entity`, e.g. "employee". */
  entity?: string;
  /** Anything that is not a run status matches no run. */
  status?: string;
};

export type ListRunsInput = RunListFilters & {
  /** Page size (default 25, at most 200). */
  limit?: number;
  /** `nextCursor` of the previous page. */
  cursor?: string | null;
};

export type RunListItem = {
  id: string;
  sourceSystem: string | null;
  adapter: string | null;
  entity: string;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  counts: Partial<IngestCounts>;
  /** Entries in the reject log (staging failures and identity conflicts). */
  issues: number;
  error: string | null;
};

export type RunListPage = { runs: RunListItem[]; nextCursor: string | null };

export type RunDetail = Omit<RunListItem, "issues"> & {
  params: Record<string, unknown>;
  rejects: IngestReject[];
  /** Payloads this run landed in raw_record (re-seen payloads are not repeated). */
  rawRecordCount: number;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keyset cursor over (started_at, id), the order of `ingest_run_started_at_idx`.
 * The instant travels as text with microseconds: a JS Date would truncate to
 * milliseconds and rows within that millisecond could be skipped or repeated.
 */
const cursorInstant = sql<string>`to_char(${ingestRun.startedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function encodeCursor(instant: string, id: string): string {
  return Buffer.from(JSON.stringify([instant, id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/.test(parsed[0]) &&
      typeof parsed[1] === "string" &&
      UUID.test(parsed[1])
    ) {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // fall through: an unreadable cursor is treated as no cursor
  }
  return null;
}

/**
 * Ingest runs, newest first, optionally filtered. Pages are keyset-based on
 * (started_at, id), so concurrent new runs never shift or repeat rows; an
 * unreadable cursor starts from the top.
 */
export async function listRuns(
  db: DbOrTx,
  { source, entity, status, limit = DEFAULT_LIMIT, cursor }: ListRunsInput = {},
): Promise<RunListPage> {
  const size = Math.min(
    Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const after = cursor ? decodeCursor(cursor) : null;
  // status is an enum: comparing it with a made-up value would be a SQL error.
  if (status !== undefined && !isRunStatus(status)) {
    return { runs: [], nextCursor: null };
  }
  const where: (SQL | undefined)[] = [
    source ? eq(ingestRun.sourceSystem, source) : undefined,
    entity ? eq(ingestRun.entity, entity) : undefined,
    status ? eq(ingestRun.status, status) : undefined,
    after
      ? sql`(${ingestRun.startedAt}, ${ingestRun.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
      : undefined,
  ];

  const rows = await db
    .select({
      id: ingestRun.id,
      sourceSystem: ingestRun.sourceSystem,
      adapter: ingestRun.adapter,
      entity: ingestRun.entity,
      status: ingestRun.status,
      startedAt: ingestRun.startedAt,
      finishedAt: ingestRun.finishedAt,
      counts: ingestRun.counts,
      issues: sql<number>`case when jsonb_typeof(${ingestRun.rejects}) = 'array'
        then jsonb_array_length(${ingestRun.rejects}) else 0 end`,
      error: ingestRun.error,
      instant: cursorInstant,
    })
    .from(ingestRun)
    .where(and(...where))
    .orderBy(desc(ingestRun.startedAt), desc(ingestRun.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page.at(-1);
  return {
    runs: page.map((r) => ({
      id: r.id,
      sourceSystem: r.sourceSystem,
      adapter: r.adapter,
      entity: r.entity,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      counts: r.counts ?? {},
      issues: Number(r.issues),
      error: r.error,
    })),
    nextCursor:
      rows.length > size && last ? encodeCursor(last.instant, last.id) : null,
  };
}

/** One run with its params, reject log and raw record count; null if absent. */
export async function getRun(
  db: DbOrTx,
  id: string,
): Promise<RunDetail | null> {
  if (!UUID.test(id)) return null;
  const [run] = await db
    .select({
      id: ingestRun.id,
      sourceSystem: ingestRun.sourceSystem,
      adapter: ingestRun.adapter,
      entity: ingestRun.entity,
      status: ingestRun.status,
      startedAt: ingestRun.startedAt,
      finishedAt: ingestRun.finishedAt,
      params: ingestRun.params,
      counts: ingestRun.counts,
      rejects: ingestRun.rejects,
      error: ingestRun.error,
      // Drizzle drops table qualifiers in single-table selects: spell it out.
      rawRecordCount: sql<number>`(
        select count(*) from ${rawRecord} rr where rr.run_id = "ingest_run"."id"
      )`,
    })
    .from(ingestRun)
    .where(eq(ingestRun.id, id));
  if (!run) return null;
  return {
    ...run,
    params: run.params ?? {},
    counts: run.counts ?? {},
    rejects: run.rejects ?? [],
    rawRecordCount: Number(run.rawRecordCount),
  };
}

/** Distinct entities that have at least one run (for the list filter). */
export async function listRunEntities(db: DbOrTx): Promise<string[]> {
  const rows = await db
    .selectDistinct({ entity: ingestRun.entity })
    .from(ingestRun)
    .orderBy(ingestRun.entity);
  return rows.map((r) => r.entity);
}
