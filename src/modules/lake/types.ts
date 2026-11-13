/** A JSON-safe value: what a lake row can contain after reading. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * One lake row, keyed by column name. Values are JSON-safe: BIGINT/DECIMAL
 * come as strings (lossless), timestamps as UTC strings, missing values as null.
 */
export type LakeRow = Record<string, JsonValue>;

export interface LakeColumn {
  name: string;
  /** Type name as the adapter reports it (e.g. DuckDB `BIGINT`). */
  type: string;
  nullable: boolean;
}

export interface ReadOptions {
  /** Primary key columns: tiebreaker so paging is stable. Required. */
  keyColumns: string[];
  /** Monotonic-ish change column (updated_at, last_changed, _fivetran_synced). */
  watermarkColumn?: string;
  /**
   * Last committed watermark. Rows with `watermark >= since` are re-read
   * (at-least-once; the consumer upserts). Rows whose watermark is NULL are
   * always read, because they can't be proven old. Ignored without a
   * `watermarkColumn`. `null` / `undefined` = full read.
   */
  since?: string | null;
  /** Rows per batch. Default 1000. */
  batchSize?: number;
  /** Projection. Key and watermark columns are always included. */
  columns?: string[];
}

export interface LakeBatch {
  rows: LakeRow[];
  /**
   * Highest watermark in this batch (null without a watermark column or when
   * every row has a NULL watermark). Persist it only after the batch commits.
   */
  watermark: string | null;
}

/**
 * Source-agnostic reader over a data lake (or a folder of files standing in
 * for one). Rows come ordered by (watermark, ...keyColumns) and every row of
 * the table is returned exactly once per pass, whatever the batch size.
 */
export interface LakeAdapter {
  listTables(): Promise<string[]>;
  describeTable(table: string): Promise<LakeColumn[]>;
  readBatches(table: string, opts: ReadOptions): AsyncGenerator<LakeBatch>;
  close(): Promise<void>;
}
