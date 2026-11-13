import { readSheet } from "read-excel-file/node";
import { basename } from "node:path";

/** What a worksheet cell holds after parsing (the library's types are loose). */
type Cell = string | boolean | Date | null | undefined;

function cellToText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) {
    // Excel dates carry no zone; the reader gives them as UTC instants. A
    // midnight value is a plain date, anything else a timestamp.
    const iso = cell.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  return String(cell);
}

function csvField(text: string): string {
  return /[",\r\n]|^\s|\s$/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

/**
 * Convert the first worksheet of an .xlsx file to CSV text, so DuckDB can
 * read it like any other file. The first row is the header. Numeric cells
 * keep the digits stored in the file (no float round trip), dates become
 * ISO 8601 in UTC, blank rows are dropped.
 *
 * The text is only exact if the reader does not re-type it: `DuckDbFileLake`
 * reads these conversions with `all_varchar`, because a CSV type sniffer
 * would turn a mixed numeric column into DOUBLE (12.50 -> 12.5, long ids
 * rounded).
 */
export async function xlsxToCsv(path: string): Promise<string> {
  let rows: Cell[][];
  try {
    // parseNumber: hand numbers over as the text stored in the file instead of
    // a JS number, so nothing is rounded or reformatted on the way to the csv.
    const sheet = await readSheet(path, { parseNumber: (text) => text });
    rows = sheet as unknown as Cell[][];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot read "${basename(path)}" as an xlsx workbook: ${reason}`,
      { cause: error },
    );
  }

  const lines = rows
    .map((row) => row.map(cellToText))
    .filter((cells) => cells.some((text) => text !== ""));
  const width = Math.max(0, ...lines.map((cells) => cells.length));
  return (
    lines
      .map((cells) =>
        Array.from({ length: width }, (_, i) => csvField(cells[i] ?? "")).join(
          ",",
        ),
      )
      .join("\n") + "\n"
  );
}
