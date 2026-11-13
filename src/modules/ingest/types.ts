import type { SourceSystem } from "@/db/schema";

/**
 * `employee`: one record per employee. `job_history`: one record per employee
 * with all its jobInfo and employmentStatus rows (see JobHistoryPayload).
 * `goal`: one record per goal of each employee in `ctx.employeeIds` (see
 * GoalPayload); it has its own runner (`runGoalIngest`), not `runIngest`.
 */
export type Entity = "employee" | "job_history" | "goal";

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
  /** Incremental extraction: only records changed since then (if supported). */
  since?: string;
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

/** Anything that can produce raw records for our entities. */
export interface SourceAdapter {
  readonly source: SourceSystem;
  /** Free-form adapter name stored on ingest_run (e.g. "fixture"). */
  readonly name: string;
  readonly entities: readonly Entity[];
  extract(ctx: ExtractContext, entity: Entity): AsyncIterable<ExtractedRecord>;
}
