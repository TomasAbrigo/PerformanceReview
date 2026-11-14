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

/**
 * Last line of a file whose rows stopped coming (a query failed after the
 * response had started): a comment no CSV parser mistakes for data, so a
 * consumer can tell the file is incomplete.
 */
export const CSV_INTERRUPTED =
  "# EXPORT INTERRUPTED: the file is incomplete, download it again\r\n";

/**
 * A `text/csv` attachment that streams `rows` as they are produced. The
 * first row is read before answering: a failure there is still an ordinary
 * error (the caller turns it into a 500), not a 200 with a broken file. A
 * failure on a later page is logged and ends the file with `CSV_INTERRUPTED`.
 */
export async function csvResponse<R>(
  filename: string,
  rows: AsyncIterable<R> | Iterable<R>,
  columns: CsvColumn<R>[],
): Promise<Response> {
  const encoder = new TextEncoder();
  const chunks = csvStream(rows, columns);
  // The header, then the first row (the first query).
  const queue: string[] = [];
  let finished = false;
  for (let i = 0; i < 2 && !finished; i++) {
    const next = await chunks.next();
    if (next.done) finished = true;
    else queue.push(next.value);
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const queued = queue.shift();
      if (queued !== undefined) {
        controller.enqueue(encoder.encode(queued));
        return;
      }
      if (finished) {
        controller.close();
        return;
      }
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        console.error("CSV export failed after it had started", error);
        controller.enqueue(encoder.encode(CSV_INTERRUPTED));
        controller.close();
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
