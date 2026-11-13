import { pgEnum, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Where a row came from. Joins never use source ids, only our UUIDs. */
export const sourceSystem = pgEnum("source_system", [
  "bamboo_api",
  "bamboo_export",
  "lake",
  "native",
]);

export type SourceSystem = (typeof sourceSystem.enumValues)[number];

/** created_at / updated_at for tables that are not source-backed. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Columns every domain table carries (PRD "Convenciones de datos",
 * docs/research/03): where the row came from (`native` for rows created in
 * this app), its id in that source, the run that last wrote it, the payload
 * hash, audit timestamps and soft delete. Pair with a unique constraint on
 * (source_system, source_id).
 */
export const sourceColumns = {
  sourceSystem: sourceSystem("source_system").notNull().default("native"),
  sourceId: text("source_id"),
  ingestRunId: uuid("ingest_run_id"),
  payloadHash: text("payload_hash"),
  ...timestamps,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};
