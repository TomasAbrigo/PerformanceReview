import { ingestRunStatus, type IngestRunStatus } from "@/db/schema/ingest";

/** Lifecycle of an `ingest_run`: the `ingest_run_status` enum of the schema. */
export const RUN_STATUSES = ingestRunStatus.enumValues;

export type RunStatus = IngestRunStatus;

export const isRunStatus = (value: unknown): value is RunStatus =>
  (RUN_STATUSES as readonly unknown[]).includes(value);
