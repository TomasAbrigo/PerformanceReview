/** Lifecycle of an `ingest_run` (stored as text in `ingest_run.status`). */
export const RUN_STATUSES = ["running", "succeeded", "error"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const isRunStatus = (value: unknown): value is RunStatus =>
  (RUN_STATUSES as readonly unknown[]).includes(value);
