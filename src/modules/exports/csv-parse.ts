// Dependency-free on purpose: the e2e specs (Playwright, outside the app's
// module setup) parse the CSVs they download with it too.

/** U+FEFF: the BOM the exports start with (see `CSV_BOM` in ./csv). */
const BOM = "\uFEFF";

/** RFC 4180 parser: rows of cells (the BOM stripped). */
export function parseCsv(text: string): string[][] {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && body[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return rows;
}
