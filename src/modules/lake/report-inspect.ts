import { copyFile, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import readXlsxFile from "read-excel-file/node";
import { errorMessage } from "@/lib/log";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { UPLOAD_EXTENSIONS } from "./upload-shared";

/**
 * `pnpm reports:inspect <file>`: what a Bamboo report export looks like
 * before importing it, WITHOUT showing its data. Prints the file, the sheet
 * (xlsx), the row count and, per column, its header and how many cells are
 * non-empty and distinct. Cell values are never printed: the reports hold
 * people's names and their reviews, and this output ends up in tickets.
 */

export const INSPECT_USAGE = `Usage: pnpm reports:inspect <file>
  <file>  a report export (${UPLOAD_EXTENSIONS.join(", ")})
Prints headers and counts per column, never a cell value.`;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseInspectArgs(argv: string[]): { file: string } {
  let positionals: string[];
  try {
    ({ positionals } = parseArgs({
      args: argv,
      options: {},
      allowPositionals: true,
      strict: true,
    }));
  } catch (err) {
    throw new UsageError(errorMessage(err));
  }
  if (positionals.length !== 1) {
    throw new UsageError("Pass exactly one file");
  }
  const [file] = positionals;
  if (!UPLOAD_EXTENSIONS.includes(extname(file).toLowerCase())) {
    throw new UsageError(
      `Unsupported file type "${extname(file)}" (expected ${UPLOAD_EXTENSIONS.join(", ")})`,
    );
  }
  return { file };
}

export type ColumnProfile = {
  header: string;
  /** Cells with a value (not null, not blank). */
  nonEmpty: number;
  /** Different non-empty values. */
  distinct: number;
};

export type ReportInspection = {
  fileName: string;
  /** The sheet read (the first one) for an xlsx; null otherwise. */
  sheet: string | null;
  rows: number;
  columns: ColumnProfile[];
};

const TABLE = "report";

export async function inspectReport(file: string): Promise<ReportInspection> {
  const ext = extname(file).toLowerCase();
  const sheet =
    ext === ".xlsx" ? ((await readXlsxFile(file))[0]?.sheet ?? null) : null;
  // The lake reads a folder: the file shows up there under a fixed name.
  const dir = await mkdtemp(join(tmpdir(), "reports-inspect-"));
  try {
    const link = join(dir, `${TABLE}${ext}`);
    await symlink(resolve(file), link).catch(() =>
      copyFile(resolve(file), link),
    );
    const lake = await DuckDbFileLake.open(dir);
    try {
      const described = await lake.describeTable(TABLE);
      const stats = described.map(() => ({ nonEmpty: 0, values: new Set() }));
      let rows = 0;
      for await (const batch of lake.readBatches(TABLE, {
        keyColumns: [described[0].name],
      })) {
        for (const row of batch.rows) {
          rows++;
          described.forEach(({ name }, i) => {
            const value = row[name];
            if (value === null || value === undefined) return;
            if (typeof value === "string" && value.trim() === "") return;
            stats[i].nonEmpty++;
            stats[i].values.add(JSON.stringify(value));
          });
        }
      }
      return {
        fileName: basename(file),
        sheet,
        rows,
        columns: described.map(({ name }, i) => ({
          header: name,
          nonEmpty: stats[i].nonEmpty,
          distinct: stats[i].values.size,
        })),
      };
    } finally {
      await lake.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The inspection as text: headers and numbers only. */
export function formatInspection(report: ReportInspection): string {
  const width = Math.max(6, ...report.columns.map((c) => c.header.length));
  const lines = [
    `File: ${report.fileName}`,
    ...(report.sheet !== null ? [`Sheet: ${report.sheet}`] : []),
    `Rows: ${report.rows}`,
    `Columns: ${report.columns.length}`,
    "",
    `${"#".padStart(3)}  ${"Header".padEnd(width)}  ${"Non-empty".padStart(9)}  ${"Distinct".padStart(8)}`,
    ...report.columns.map(
      (c, i) =>
        `${String(i + 1).padStart(3)}  ${c.header.padEnd(width)}  ${String(c.nonEmpty).padStart(9)}  ${String(c.distinct).padStart(8)}`,
    ),
  ];
  return lines.join("\n");
}

type Output = { log: (line: string) => void; error: (line: string) => void };

/** Exit codes: 0 printed, 1 the file could not be read, 2 bad arguments. */
export async function runInspectCli(
  argv: string[],
  out: Output = console,
): Promise<number> {
  let args;
  try {
    args = parseInspectArgs(argv);
  } catch (err) {
    out.error(errorMessage(err));
    out.error(INSPECT_USAGE);
    return 2;
  }
  try {
    out.log(formatInspection(await inspectReport(args.file)));
    return 0;
  } catch (err) {
    // Errors name the file, not its content (DuckDB quotes no cells here).
    out.error(`Cannot read ${basename(args.file)}: ${errorMessage(err)}`);
    return 1;
  }
}
