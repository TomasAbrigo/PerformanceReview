import { pgEnum, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Where a row came from. Joins never use source ids, only our UUIDs. */
export const sourceSystem = pgEnum("source_system", [
  "bamboo_api",
  "bamboo_export",
  "lake",
  "native",
]);

export type SourceSystem = (typeof sourceSystem.enumValues)[number];

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Columns every source-backed domain table carries (PRD "Convenciones de
 * datos"). Pair with a unique index on (source_system, source_id).
 */
export const sourceColumns = () => ({
  sourceSystem: sourceSystem("source_system").notNull(),
  sourceId: text("source_id").notNull(),
  ingestRunId: uuid("ingest_run_id"),
  payloadHash: text("payload_hash"),
  ...timestamps(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
