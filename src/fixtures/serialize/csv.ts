/** Minimal RFC 4180 CSV writer/reader (UTF-8, "\n" line ends). */

function escapeCell(cell: string): string {
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string {
  const lines = [header, ...rows].map((row) =>
    row.map((cell) => escapeCell(String(cell))).join(","),
  );
  return `${lines.join("\n")}\n`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
