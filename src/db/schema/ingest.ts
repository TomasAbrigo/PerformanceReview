import {
  jsonb,
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
  /** Records held (or flagged) in the identity queue instead of applied. */
  issues: number;
};

export type IngestReject = { sourceId: string | null; reason: string };

/** One execution of an ingestion adapter (e.g. a BambooHR import). */
export const ingestRun = pgTable("ingest_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceSystem: text("source_system"),
  adapter: text("adapter"),
  params: jsonb("params").$type<Record<string, unknown>>(),
  status: text("status"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  counts: jsonb("counts").$type<Partial<IngestCounts>>(),
  rejects: jsonb("rejects").$type<IngestReject[]>(),
  error: text("error"),
});

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
