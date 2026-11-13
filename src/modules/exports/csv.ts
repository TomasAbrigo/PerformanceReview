/**
 * CSV writer (RFC 4180) for the exports: UTF-8 BOM so Excel opens accents
 * right, CRLF line ends, fields quoted only when they need it. Rows can come
 * from any (async) iterable, so a big export streams page by page instead of
 * living in memory.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

export type CsvColumn<R> = {
  /** Header cell, in the file's language. */
  header: string;
  value: (row: R) => CsvValue;
};

/** U+FEFF: encoded as UTF-8 (EF BB BF) it makes Excel read the file as UTF-8. */
export const CSV_BOM = "﻿";
const EOL = "\r\n";

/** Plain numbers ("-5", "+3.2") are data, not formulas. */
const NUMERIC = /^[+-]?\d+([.,]\d+)?$/;
/** What spreadsheets treat as the start of a formula (OWASP "CSV injection"). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One cell. Dates become ISO instants, null/undefined empty. Text a
 * spreadsheet would evaluate as a formula (`=`, `+`, `-`, `@`, tab, CR at the
 * start) gets a leading apostrophe so a name or goal title cannot run code.
 */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "string"
        ? value
        : String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) {
    if (!NUMERIC.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const line = (cells: string[]) => cells.join(",") + EOL;

const headerLine = <R>(columns: CsvColumn<R>[]) =>
  CSV_BOM + line(columns.map((c) => csvField(c.header)));

const rowLine = <R>(row: R, columns: CsvColumn<R>[]) =>
  line(columns.map((c) => csvField(c.value(row))));

/** The whole file as a string (tests, small exports). */
export function toCsv<R>(rows: Iterable<R>, columns: CsvColumn<R>[]): string {
  let out = headerLine(columns);
  for (const row of rows) out += rowLine(row, columns);
  return out;
}

/** The file as chunks: the header (with the BOM) first, then one per row. */
export async function* csvStream<R>(
  rows: AsyncIterable<R> | Iterable<R>,
  columns: CsvColumn<R>[],
): AsyncGenerator<string> {
  yield headerLine(columns);
  for await (const row of rows) yield rowLine(row, columns);
}

/** A `text/csv` attachment that streams `rows` as they are produced. */
export function csvResponse<R>(
  filename: string,
  rows: AsyncIterable<R> | Iterable<R>,
  columns: CsvColumn<R>[],
): Response {
  const encoder = new TextEncoder();
  const chunks = csvStream(rows, columns);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
