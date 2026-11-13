import { text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Columns every domain table carries (see docs/research/03): where the row came
 * from (`native` for rows created in this app), its id in that source, and
 * audit timestamps.
 */
export const sourceColumns = {
  sourceSystem: text("source_system").notNull().default("native"),
  sourceId: text("source_id"),
  ingestRunId: uuid("ingest_run_id"),
  payloadHash: text("payload_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
