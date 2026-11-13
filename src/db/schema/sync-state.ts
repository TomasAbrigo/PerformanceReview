import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { ingestRun } from "./ingest";
import { sourceSystem } from "./source";

/**
 * Where the next incremental extraction of an entity starts, per source and
 * adapter (the fixtures also report `bamboo_api`; they must not move the
 * watermark of the live API).
 * Only ever advanced after a run has fully committed (never by a failed run).
 */
export const syncState = pgTable(
  "sync_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSystem: sourceSystem("source_system").notNull(),
    /** `SourceAdapter.name` ("bamboo", "fixture", ...). */
    adapter: text("adapter").notNull(),
    entity: text("entity").notNull(),
    /** Opaque to us: the adapter's high-water mark (an ISO instant for Bamboo). */
    watermark: text("watermark"),
    /** Opaque paging cursor for adapters that can resume mid-extraction. */
    cursor: text("cursor"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    /** The successful run that produced the current watermark. */
    lastRunId: uuid("last_run_id").references(() => ingestRun.id),
  },
  (t) => [
    unique("sync_state_source_adapter_entity_uq").on(
      t.sourceSystem,
      t.adapter,
      t.entity,
    ),
  ],
);

export type SyncState = typeof syncState.$inferSelect;
