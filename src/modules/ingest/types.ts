import type { SourceSystem } from "@/db/schema";

/**
 * `employee`: one record per employee. `job_history`: one record per employee
 * with all its jobInfo and employmentStatus rows (see JobHistoryPayload).
 */
export type Entity = "employee" | "job_history";

/** Raw payload of a `job_history` record: table rows exactly as Bamboo sent them. */
export type JobHistoryPayload = {
  employeeId: string;
  jobInfo: Record<string, unknown>[];
  employmentStatus: Record<string, unknown>[];
};

export type ExtractedRecord = {
  /** The source's own immutable key (Bamboo internal id), as a string. */
  sourceId: string;
  payload: unknown;
  extractedAt: Date;
};

export type ExtractContext = {
  signal?: AbortSignal;
  /** Incremental extraction: only records changed since then (if supported). */
  since?: string;
};

/** Anything that can produce raw records for our entities. */
export interface SourceAdapter {
  readonly source: SourceSystem;
  /** Free-form adapter name stored on ingest_run (e.g. "fixture"). */
  readonly name: string;
  readonly entities: readonly Entity[];
  extract(ctx: ExtractContext, entity: Entity): AsyncIterable<ExtractedRecord>;
}
