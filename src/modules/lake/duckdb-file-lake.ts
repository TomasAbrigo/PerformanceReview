import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBValue,
} from "@duckdb/node-api";
import { quote, sqlString } from "./sql";
import type {
  JsonValue,
  LakeAdapter,
  LakeBatch,
  LakeColumn,
  LakeRow,
  ReadOptions,
} from "./types";
import { xlsxToCsv } from "./xlsx";

/**
 * Hidden last tiebreaker: position of the row in the file. Without it, rows
 * identical in (watermark, keys) would be skipped by keyset paging. A source
 * column with this name is refused.
 */
const ROW_POSITION = "__lake_row_position";

const XLSX = ".xlsx";

/** File extension -> DuckDB table function that reads it. */
const READERS: Record<string, string> = {
  ".csv": "read_csv",
  ".parquet": "read_parquet",
  ".json": "read_json",
  ".ndjson": "read_ndjson",
  ".jsonl": "read_ndjson",
};

/** Where a table's rows come from. */
interface TableFile {
  path: string;
  /** Converted from .xlsx: read as text, exactly as written in the cells. */
  textOnly: boolean;
}

/** A table loaded into the in-memory database, with its source columns. */
interface LoadedTable {
  sqlName: string;
  columns: LakeColumn[];
}

/** Rows come ordered by watermark, NULLs last: the max is the last non-NULL. */
function maxWatermark(rows: LakeRow[], column: string): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = rows[i][column];
    if (value !== null) return String(value);
  }
  return null;
}

/**
 * SQL casting the bound `since` text to the watermark's type. For temporal
 * columns `since` is parsed as an instant first: casting text such as
 * `2026-01-10T10:30:00-03:00` straight to a zone-less TIMESTAMP would drop the
 * offset. Zone-less columns are therefore read as UTC.
 */
function sinceAs(type: string, param: string): string {
  if (type === "TIMESTAMP WITH TIME ZONE") return `CAST(${param} AS ${type})`;
  if (type === "DATE" || type.startsWith("TIMESTAMP")) {
    return `CAST(CAST(${param} AS TIMESTAMP WITH TIME ZONE) AS ${type})`;
  }
  return `CAST(${param} AS ${type})`;
}

/**
 * Lake over a directory of `<table>.{csv,parquet,json,ndjson,xlsx}` files,
 * queried in process with DuckDB. Table names come only from the directory
 * listing.
 *
 * A table is read from its file once, on first use, into a temporary
 * in-memory table (types are inferred from the whole file there), and every
 * page is served from that snapshot: later edits of the file are not seen
 * until the lake is opened again. Each page is a top-N over the snapshot, so
 * this is meant for files of up to a few hundred thousand rows.
 */
export class DuckDbFileLake implements LakeAdapter {
  private readonly tables = new Map<string, Promise<LoadedTable>>();
  private loadedCount = 0;
  private closed = false;

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly conn: DuckDBConnection,
    private readonly files: Map<string, TableFile>,
    private readonly conversions: string | undefined,
  ) {}

  /**
   * Open the lake over the files of `dir` (not recursive; folders are
   * ignored). One table per file, named after the file without extension.
   * `.xlsx` files are converted to csv in a temporary folder, removed on
   * `close()`.
   */
  static async open(dir: string): Promise<DuckDbFileLake> {
    const listing = new Map<string, string>(); // table -> file name
    for (const file of await readdir(dir)) {
      const ext = extname(file);
      // Skip editor swap files and Office lock files (~$report.xlsx).
      if (file.startsWith(".") || file.startsWith("~$")) continue;
      if (!READERS[ext] && ext !== XLSX) continue;
      // Regular files only (symlinks are followed): a folder named
      // employee.parquet is not a table.
      const isFile = await stat(resolve(dir, file)).then(
        (s) => s.isFile(),
        () => false,
      );
      if (!isFile) continue;
      const table = basename(file, ext);
      const other = listing.get(table);
      if (other) {
        throw new Error(
          `Ambiguous table "${table}": ${other} and ${file} in ${dir}`,
        );
      }
      listing.set(table, file);
    }

    const files = new Map<string, TableFile>();
    let conversions: string | undefined;
    let instance: DuckDBInstance | undefined;
    try {
      for (const [table, file] of listing) {
        const path = resolve(dir, file);
        if (extname(file) !== XLSX) {
          files.set(table, { path, textOnly: false });
          continue;
        }
        conversions ??= await mkdtemp(join(tmpdir(), "lake-xlsx-conv-"));
        const csvPath = join(conversions, `${table}.csv`);
        await writeFile(csvPath, await xlsxToCsv(path));
        files.set(table, { path: csvPath, textOnly: true });
      }
      instance = await DuckDBInstance.create(":memory:");
      const conn = await instance.connect();
      // Rendering of timestamps must not depend on the machine's time zone.
      await conn.run(`SET TimeZone='UTC'`);
      return new DuckDbFileLake(instance, conn, files, conversions);
    } catch (error) {
      instance?.closeSync();
      if (conversions) await rm(conversions, { recursive: true, force: true });
      throw error;
    }
  }

  /** SQL table expression for a table. The path comes from our own listing. */
  private source(table: string): string {
    const file = this.files.get(table);
    if (!file) throw new Error(`Unknown table "${table}"`);
    const path = sqlString(file.path);
    if (file.textOnly) return `read_csv(${path}, all_varchar=true)`;
    // sample_size=-1: infer types from the whole file, not a 20k-row sample.
    return extname(file.path) === ".csv"
      ? `read_csv(${path}, sample_size=-1)`
      : `${READERS[extname(file.path)]}(${path})`;
  }

  /** The table loaded into memory, loading it on first use. */
  private load(table: string): Promise<LoadedTable> {
    let loaded = this.tables.get(table);
    if (!loaded) {
      loaded = this.materialize(table);
      this.tables.set(table, loaded);
      // A failed load is not cached: the next call retries.
      loaded.catch(() => this.tables.delete(table));
    }
    return loaded;
  }

  private async materialize(table: string): Promise<LoadedTable> {
    const source = this.source(table); // fails fast on unknown tables
    const sqlName = `__lake_table_${this.loadedCount++}`;
    await this.conn.run(
      `CREATE TEMP TABLE ${quote(sqlName)} AS
       SELECT *, row_number() OVER () AS ${quote(ROW_POSITION)} FROM ${source}`,
    );
    const described = await this.conn.runAndReadAll(
      `DESCRIBE SELECT * FROM ${quote(sqlName)}`,
    );
    const columns = described.getRowObjectsJson().map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      nullable: row.null === "YES",
    }));
    // If the file already has a column with our name, DuckDB renames ours.
    const ours = columns.pop();
    if (
      ours?.name !== ROW_POSITION ||
      columns.some((c) => c.name === ROW_POSITION)
    ) {
      await this.conn.run(`DROP TABLE ${quote(sqlName)}`);
      throw new Error(
        `Table "${table}" has a column named "${ROW_POSITION}", which is reserved by the lake adapter for paging: rename it in the file`,
      );
    }
    return { sqlName, columns };
  }

  async listTables(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }

  async describeTable(table: string): Promise<LakeColumn[]> {
    const { columns } = await this.load(table);
    return columns.map((column) => ({ ...column }));
  }

  async *readBatches(
    table: string,
    opts: ReadOptions,
  ): AsyncGenerator<LakeBatch> {
    const { sqlName, columns } = await this.load(table);
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

    let cursor: JsonValue[] | null = null; // order columns of the last row
    for (;;) {
      const params: Record<string, DuckDBValue> = { batch_size: batchSize };
      const filters: string[] = [];
      if (wm && opts.since != null) {
        // At-least-once: `>=` re-reads the boundary rows; the consumer upserts.
        // NULL watermarks can't be proven old, so they are always read.
        params.since = opts.since;
        filters.push(
          `(${col(wm)} >= ${sinceAs(types.get(wm)!, "$since")} OR ${col(wm)} IS NULL)`,
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
        `SELECT ${select} FROM ${quote(sqlName)} AS src WHERE ${where} ORDER BY ${order} LIMIT $batch_size`,
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

  /** Release the database and delete temporary conversions. Safe to repeat. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn.closeSync();
      this.instance.closeSync();
    } finally {
      if (this.conversions) {
        await rm(this.conversions, { recursive: true, force: true });
      }
    }
  }
}
