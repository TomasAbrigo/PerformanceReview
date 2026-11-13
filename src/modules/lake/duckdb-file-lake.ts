import { readdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBValue,
} from "@duckdb/node-api";
import type {
  JsonValue,
  LakeAdapter,
  LakeBatch,
  LakeColumn,
  LakeRow,
  ReadOptions,
} from "./types";

/**
 * Hidden last tiebreaker: position of the row in the file. Without it, rows
 * identical in (watermark, keys) would be skipped by keyset paging.
 */
const ROW_POSITION = "__lake_row_position";

/** Quote an SQL identifier. */
const quote = (id: string) => `"${id.replaceAll('"', '""')}"`;

/** File extension -> DuckDB table function that reads it. */
const READERS: Record<string, string> = {
  ".csv": "read_csv",
  ".parquet": "read_parquet",
  ".json": "read_json",
  ".ndjson": "read_ndjson",
  ".jsonl": "read_ndjson",
};

/** Rows come ordered by watermark, NULLs last: the max is the last non-NULL. */
function maxWatermark(rows: LakeRow[], column: string): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = rows[i][column];
    if (value !== null) return String(value);
  }
  return null;
}

/**
 * Lake over a directory of `<table>.{csv,parquet,json,ndjson}` files, queried
 * in process with DuckDB. Table names come only from the directory listing.
 */
export class DuckDbFileLake implements LakeAdapter {
  private constructor(
    private readonly conn: DuckDBConnection,
    private readonly files: Map<string, string>,
  ) {}

  static async open(dir: string): Promise<DuckDbFileLake> {
    const files = new Map<string, string>();
    for (const file of await readdir(dir)) {
      if (!READERS[extname(file)]) continue;
      const table = basename(file, extname(file));
      if (files.has(table)) {
        throw new Error(
          `Ambiguous table "${table}": more than one file in ${dir} (${basename(files.get(table)!)}, ${file})`,
        );
      }
      files.set(table, resolve(join(dir, file)));
    }
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    // Rendering of timestamps must not depend on the machine's time zone.
    await conn.run(`SET TimeZone='UTC'`);
    return new DuckDbFileLake(conn, files);
  }

  /** SQL table expression for a table. The path comes from our own listing. */
  private source(table: string): string {
    const path = this.files.get(table);
    if (!path) throw new Error(`Unknown table "${table}"`);
    const literal = path.replaceAll("'", "''");
    // sample_size=-1: infer types from the whole file, not a 20k-row sample.
    return extname(path) === ".csv"
      ? `read_csv('${literal}', sample_size=-1)`
      : `${READERS[extname(path)]}('${literal}')`;
  }

  async listTables(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }

  async describeTable(table: string): Promise<LakeColumn[]> {
    const result = await this.conn.runAndReadAll(
      `DESCRIBE SELECT * FROM ${this.source(table)}`,
    );
    return result.getRowObjectsJson().map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      nullable: row.null === "YES",
    }));
  }

  async *readBatches(
    table: string,
    opts: ReadOptions,
  ): AsyncGenerator<LakeBatch> {
    const columns = await this.describeTable(table);
    const types = new Map(columns.map((c) => [c.name, c.type]));
    const { watermarkColumn: wm, keyColumns } = opts;
    const batchSize = opts.batchSize ?? 1000;
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new Error(`batchSize must be a positive integer, got ${batchSize}`);
    }
    if (keyColumns.length === 0) {
      throw new Error("At least one key column is required to page stably");
    }
    // Identifiers are quoted, but also checked against the table's own columns.
    const known = (column: string) => {
      if (!types.has(column)) {
        throw new Error(`Unknown column "${column}" in table "${table}"`);
      }
      return column;
    };
    const selected = new Set([
      ...(opts.columns ?? columns.map((c) => c.name)).map(known),
      ...(wm ? [known(wm)] : []),
      ...keyColumns.map(known),
    ]);
    types.set(ROW_POSITION, "BIGINT");
    const orderColumns = [...(wm ? [wm] : []), ...keyColumns, ROW_POSITION];

    // Qualified (`src."col"`) so ORDER BY / WHERE use the real column, never a
    // SELECT alias of the same name (the TIMESTAMPTZ -> VARCHAR casts below).
    const col = (column: string) => `src.${quote(column)}`;
    const order = orderColumns.map(col).join(", ");
    // TIMESTAMPTZ is rendered in the process time zone by the driver; casting
    // to VARCHAR in SQL applies the session's UTC instead.
    const select = [...selected, ROW_POSITION]
      .map((c) =>
        types.get(c) === "TIMESTAMP WITH TIME ZONE"
          ? `CAST(${col(c)} AS VARCHAR) AS ${quote(c)}`
          : `${col(c)} AS ${quote(c)}`,
      )
      .join(", ");
    // `OVER ()` follows file order because DuckDB preserves insertion order.
    const from = `(SELECT *, row_number() OVER () AS ${quote(ROW_POSITION)} FROM ${this.source(table)}) AS src`;

    let cursor: JsonValue[] | null = null; // order columns of the last row
    for (;;) {
      const params: Record<string, DuckDBValue> = { batch_size: batchSize };
      const filters: string[] = [];
      if (wm && opts.since != null) {
        // At-least-once: `>=` re-reads the boundary rows; the consumer upserts.
        // NULL watermarks can't be proven old, so they are always read.
        params.since = opts.since;
        filters.push(
          `(${col(wm)} >= CAST($since AS ${types.get(wm)}) OR ${col(wm)} IS NULL)`,
        );
      }
      if (cursor) {
        // Keyset paging: the bound values are JSON (BIGINT as string, ...),
        // so cast them back to the column types or the tuple comparison fails.
        const bound = orderColumns.map((column, i) => {
          params[`c${i}`] = cursor![i] as DuckDBValue;
          return `CAST($c${i} AS ${types.get(column)})`;
        });
        filters.push(`(${order}) > (${bound.join(", ")})`);
      }
      const where = filters.length ? filters.join(" AND ") : "TRUE";
      const result = await this.conn.runAndReadAll(
        `SELECT ${select} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT $batch_size`,
        params,
      );
      const rows = result.getRowObjectsJson() as LakeRow[];
      if (rows.length === 0) return;
      cursor = orderColumns.map((column) => rows[rows.length - 1][column]);
      for (const row of rows) delete row[ROW_POSITION];
      yield { rows, watermark: wm ? maxWatermark(rows, wm) : null };
      if (rows.length < batchSize) return;
    }
  }

  async close(): Promise<void> {
    this.conn.closeSync();
  }
}
