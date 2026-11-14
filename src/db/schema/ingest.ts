import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sourceSystem } from "./source";

export type IngestCounts = {
  read: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  /** Employments soft-deleted because a full extraction no longer had them. */
  deleted: number;
  /** job_history: rows whose reportsTo could not be resolved to one person. */
  managerUnresolved?: number;
  /** job_history: managers matched only by the words of the name, in any order. */
  managerResolvedFuzzy?: number;
  /** employee: records held (or flagged) in the identity queue instead of applied. */
  issues?: number;
  /** employee: records a reviewer already decided to ignore, resent unchanged. */
  ignored?: number;
};

/** The counters every run shows (the optional ones are entity-specific extras). */
export const INGEST_COUNT_KEYS = [
  "read",
  "inserted",
  "updated",
  "unchanged",
  "deleted",
  "rejected",
  "issues",
  "ignored",
] as const satisfies readonly (keyof IngestCounts)[];

export type IngestReject = {
  sourceId: string | null;
  /** Human-readable cause, in English (logs, run detail). */
  reason: string;
  /** Machine-readable cause, so a UI can word it in its own language. */
  code?: string;
  /** The column the cause is about. */
  column?: string;
  /** Key values of the row (null = empty), to say which row it was. */
  values?: Record<string, string | null>;
};

/** Lifecycle of an `ingest_run`; a run that threw ends in `error`. */
export const ingestRunStatus = pgEnum("ingest_run_status", [
  "running",
  "succeeded",
  "error",
]);

export type IngestRunStatus = (typeof ingestRunStatus.enumValues)[number];

/** One execution of an ingestion adapter (e.g. a BambooHR import). */
export const ingestRun = pgTable(
  "ingest_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSystem: text("source_system"),
    adapter: text("adapter"),
    /** What the run ingested ("employee", "job_history", ...): also in `params`. */
    entity: text("entity").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>(),
    status: ingestRunStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    counts: jsonb("counts").$type<Partial<IngestCounts>>(),
    rejects: jsonb("rejects").$type<IngestReject[]>(),
    error: text("error"),
  },
  (t) => [
    // The run log is read newest first, with or without an entity filter.
    index("ingest_run_started_at_idx").on(t.startedAt.desc(), t.id.desc()),
    index("ingest_run_entity_started_at_idx").on(
      t.entity,
      t.startedAt.desc(),
      t.id.desc(),
    ),
  ],
);

export type IngestRun = typeof ingestRun.$inferSelect;
export type NewIngestRun = typeof ingestRun.$inferInsert;

/** Landing table: every distinct payload ever extracted, stored as-is. */
export const rawRecord = pgTable(
  "raw_record",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestRun.id),
    sourceSystem: sourceSystem("source_system").notNull(),
    entity: text("entity").notNull(),
    sourceId: text("source_id").notNull(),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    extractedAt: timestamp("extracted_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("raw_record_source_entity_id_hash_uq").on(
      t.sourceSystem,
      t.entity,
      t.sourceId,
      t.payloadHash,
    ),
  ],
);

export type RawRecord = typeof rawRecord.$inferSelect;
