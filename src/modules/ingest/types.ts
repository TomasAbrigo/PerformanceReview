import type { IngestReject, SourceSystem } from "@/db/schema";

/**
 * `employee`: one record per employee. `job_history`: one record per employee
 * with all its jobInfo and employmentStatus rows (see JobHistoryPayload).
 * `goal`: one record per goal of each employee in `ctx.employeeIds` (see
 * GoalPayload); it has its own runner (`runGoalIngest`), not `runIngest`.
 */
export type Entity = "employee" | "job_history" | "goal";

/**
 * Entities only files feed (Bamboo report exports): no API or fixture adapter
 * reads them, so they are not in `pnpm ingest`. Their domain handlers map the
 * Employee Performance and Feedback Status reports onto imported review
 * cycles (src/modules/import-history); any entity can also just be landed in
 * `raw_record` (landing mode, see `RunIngestInput.landing`).
 */
export type LandingEntity = "assessment" | "feedback";

/** Everything an ingest run can be about. */
export type IngestEntity = Entity | LandingEntity;

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
  /**
   * Goal records only: fetches the goal's comments (one extra request), so
   * the caller pays for it only when the comment count changed.
   */
  loadComments?: () => Promise<unknown[]>;
};

export type ExtractContext = {
  signal?: AbortSignal;
  /**
   * Incremental lower bound (the previous watermark). Adapters that cannot
   * filter by it return everything; ingestion is idempotent either way.
   */
  since?: string;
  /**
   * Where an adapter reports a row it read but cannot turn into a record
   * (e.g. a file row with an empty key). runIngest counts it as read and
   * rejected and keeps the reason on the run. An adapter called without it
   * has nowhere to put the row, so it must fail instead of dropping it.
   */
  onReject?: (reject: IngestReject) => void;
  /** Entity "goal": Bamboo ids of the employees whose goals to read. */
  employeeIds?: string[];
  /**
   * Entity "goal": called for an employee whose goals the source refused to
   * give (403/404, `status` is the HTTP status); extraction goes on with the
   * next employee. Other failures abort the extraction.
   */
  onSkip?: (skipped: SkippedEmployee) => void;
};

export type SkippedEmployee = { employeeId: string; status: number };

/**
 * Anything that can produce raw records for our entities. `E` is the entity
 * type it understands: the domain `Entity` by default; adapters for landing
 * mode (files) are `SourceAdapter<IngestEntity>`.
 */
export interface SourceAdapter<E extends IngestEntity = Entity> {
  readonly source: SourceSystem;
  /** Free-form adapter name stored on ingest_run (e.g. "fixture"). */
  readonly name: string;
  readonly entities: readonly E[];
  extract(ctx: ExtractContext, entity: E): AsyncIterable<ExtractedRecord>;
}
