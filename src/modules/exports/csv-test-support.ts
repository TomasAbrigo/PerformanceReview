import { exportRoute } from "@/modules/api/handlers";
import { parseCsv } from "./csv-parse";

export { parseCsv };

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
