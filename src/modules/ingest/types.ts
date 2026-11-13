import type { SourceSystem } from "@/db/schema";

export type Entity = "employee";

export type ExtractedRecord = {
  /** The source's own immutable key (Bamboo internal id), as a string. */
  sourceId: string;
  payload: unknown;
  extractedAt: Date;
};

export type ExtractContext = {
  signal?: AbortSignal;
  /**
   * Incremental lower bound (the previous watermark). Adapters that cannot
   * filter by it return everything; ingestion is idempotent either way.
   */
  since?: string;
};

/** Anything that can produce raw records for our entities. */
export interface SourceAdapter {
  readonly source: SourceSystem;
  /** Free-form adapter name stored on ingest_run (e.g. "fixture"). */
  readonly name: string;
  readonly entities: readonly Entity[];
  extract(ctx: ExtractContext, entity: Entity): AsyncIterable<ExtractedRecord>;
}
