import { copyFile, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import readXlsxFile from "read-excel-file/node";
import { errorMessage } from "@/lib/log";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { ASSESSMENT_STATUS_COLUMNS, CLOSED_REPORT_COLUMNS } from "./profiles";
import { UPLOAD_EXTENSIONS } from "./upload-shared";

/**
 * `pnpm reports:inspect <file>`: what a Bamboo report export looks like
 * before importing it, WITHOUT showing its data. Prints the file, the sheet
 * (xlsx), the row count and, per column, its header and how many cells are
 * non-empty and distinct. Cell values are never printed: the reports hold
 * people's names and their reviews, and this output ends up in tickets.
 */

export const INSPECT_USAGE = `Usage: pnpm reports:inspect <file> [--values]
  <file>    a report export (${UPLOAD_EXTENSIONS.join(", ")})
  --values  also the distinct values (with counts) of the closed-question and
            status columns only; a status keeps its word, never who
Prints headers and counts per column, never another cell value.`;

/**
 * The only columns whose values `--values` prints: closed answers (labels)
 * and statuses. Never names, emails, dates or free text.
 */
export const VALUE_COLUMNS: ReadonlySet<string> = new Set([
  ...CLOSED_REPORT_COLUMNS,
  ASSESSMENT_STATUS_COLUMNS.self,
  ASSESSMENT_STATUS_COLUMNS.manager,
]);

const STATUS_COLUMNS: ReadonlySet<string> = new Set([
  ASSESSMENT_STATUS_COLUMNS.self,
  ASSESSMENT_STATUS_COLUMNS.manager,
]);

/**
 * A value as `--values` shows it: a status without who ("Completed by …"),
 * and the employee's name some retention labels carry is blanked out.
 */
export function safeValue(column: string, value: string): string {
  const text = value.trim();
  if (STATUS_COLUMNS.has(column)) {
    return text.replace(/(\s(?:by|por)\s).+$/i, "$1…");
  }
  return text.replace(
    /(convince them to stay\.\s*).+?(\s+would be difficult to replace)/i,
    "$1…$2",
  );
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseInspectArgs(argv: string[]): {
  file: string;
  values?: true;
} {
  let positionals: string[];
  let values: boolean | undefined;
  try {
    ({
      positionals,
      values: { values },
    } = parseArgs({
      args: argv,
      options: { values: { type: "boolean" } },
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
  return values ? { file, values: true } : { file };
}

export type ColumnProfile = {
  header: string;
  /** Cells with a value (not null, not blank). */
  nonEmpty: number;
  /** Different non-empty values. */
  distinct: number;
  /** `--values`, closed columns only: value -> rows, most frequent first. */
  values?: [string, number][];
};

export type ReportInspection = {
  fileName: string;
  /** The sheet read (the first one) for an xlsx; null otherwise. */
  sheet: string | null;
  rows: number;
  columns: ColumnProfile[];
};

const TABLE = "report";

export async function inspectReport(
  file: string,
  options: { values?: boolean } = {},
): Promise<ReportInspection> {
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
      const stats = described.map(() => ({
        nonEmpty: 0,
        values: new Set(),
        counts: new Map<string, number>(),
      }));
      const shown = (name: string) =>
        options.values === true && VALUE_COLUMNS.has(name);
      let rows = 0;
      for await (const batch of lake.readBatches(TABLE, {
        keyColumns: [described[0].name],
        fileOrder: true,
      })) {
        for (const row of batch.rows) {
          rows++;
          described.forEach(({ name }, i) => {
            const value = row[name];
            if (value === null || value === undefined) return;
            if (typeof value === "string" && value.trim() === "") return;
            stats[i].nonEmpty++;
            stats[i].values.add(JSON.stringify(value));
            if (shown(name)) {
              const key = safeValue(name, String(value));
              stats[i].counts.set(key, (stats[i].counts.get(key) ?? 0) + 1);
            }
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
          ...(shown(name)
            ? {
                values: [...stats[i].counts].sort(
                  (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
                ),
              }
            : {}),
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
  for (const column of report.columns) {
    if (!column.values) continue;
    lines.push("", `Values of "${column.header}":`);
    for (const [value, count] of column.values) {
      lines.push(`  ${String(count).padStart(6)}  ${value}`);
    }
  }
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
    out.log(
      formatInspection(
        await inspectReport(args.file, { values: args.values === true }),
      ),
    );
    return 0;
  } catch (err) {
    // Errors name the file, not its content (DuckDB quotes no cells here).
    out.error(`Cannot read ${basename(args.file)}: ${errorMessage(err)}`);
    return 1;
  }
}
