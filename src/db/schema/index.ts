import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * One execution of an ingestion adapter (e.g. a BambooHR import).
 * Placeholder table used to validate the Drizzle + Supabase pipeline.
 */
export const ingestRun = pgTable("ingest_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceSystem: text("source_system"),
  adapter: text("adapter"),
  status: text("status"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  counts: jsonb("counts"),
  error: text("error"),
});

export type IngestRun = typeof ingestRun.$inferSelect;
export type NewIngestRun = typeof ingestRun.$inferInsert;
