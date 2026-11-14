import { exportRoute } from "@/modules/api/handlers";
import { CSV_BOM } from "./csv";

/** RFC 4180 parser: rows of cells (the BOM stripped). */
export function parseCsv(text: string): string[][] {
  const body = text.startsWith(CSV_BOM) ? text.slice(1) : text;
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

/** Calls the export route like the framework would. */
export async function download(
  file: string,
  query = "",
  headers?: HeadersInit,
): Promise<{ status: number; response: Response; text: string }> {
  const response = await exportRoute(
    new Request(`http://localhost/api/v1/export/${file}${query}`, { headers }),
    { params: Promise.resolve({ entity: file }) },
  );
  // response.text() would swallow the BOM: decode the raw bytes keeping it.
  const bytes = await response.arrayBuffer();
  return {
    status: response.status,
    response,
    text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
  };
}

/** Header + rows as records keyed by header. */
export async function table(file: string, query = "") {
  const { text } = await download(file, query);
  const [header, ...rows] = parseCsv(text);
  return {
    header,
    rows: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))),
  };
}
