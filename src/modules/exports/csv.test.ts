import { describe, expect, it, vi } from "vitest";
import {
  CSV_BOM,
  CSV_INTERRUPTED,
  csvField,
  csvResponse,
  csvStream,
  toCsv,
  type CsvColumn,
} from "./csv";

type Row = { id: string; name: string | null; n?: number };

const columns: CsvColumn<Row>[] = [
  { header: "id", value: (r) => r.id },
  { header: "nombre", value: (r) => r.name },
  { header: "n", value: (r) => r.n },
];

describe("csvField", () => {
  it("leaves plain values alone and renders null/undefined as empty", () => {
    expect(csvField("abc")).toBe("abc");
    expect(csvField(12)).toBe("12");
    expect(csvField(true)).toBe("true");
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes fields with commas, quotes and line breaks (RFC 4180)", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(csvField("a\rb")).toBe('"a\rb"');
  });

  it("renders dates as ISO instants", () => {
    expect(csvField(new Date("2026-11-13T10:20:30.123Z"))).toBe(
      "2026-11-13T10:20:30.123Z",
    );
  });

  it("defuses spreadsheet formulas in text but not in plain numbers", () => {
    expect(csvField("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvField("+1 foo")).toBe("'+1 foo");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(csvField("-cmd")).toBe("'-cmd");
    expect(csvField("\tx")).toBe("'\tx");
    // Numeric-looking text and real numbers are data, not formulas.
    expect(csvField("-5")).toBe("-5");
    expect(csvField(-5)).toBe("-5");
    expect(csvField("0003")).toBe("0003");
    expect(csvField("2026-01-02")).toBe("2026-01-02");
    // Still quoted when it also needs quoting.
    expect(csvField('=1,"2"')).toBe(`"'=1,""2"""`);
  });
});

describe("toCsv", () => {
  it("starts with a UTF-8 BOM, then the header in column order", () => {
    const csv = toCsv([], columns);
    expect(csv).toBe(`${CSV_BOM}id,nombre,n\r\n`);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("writes one CRLF-terminated line per row, in order", () => {
    const csv = toCsv(
      [
        { id: "u1", name: "Ana García", n: 1 },
        { id: "u2", name: null },
        { id: "u3", name: 'Pérez, "Bruno"\nJr.', n: 3 },
      ],
      columns,
    );
    expect(csv).toBe(
      `${CSV_BOM}id,nombre,n\r\n` +
        "u1,Ana García,1\r\n" +
        "u2,,\r\n" +
        'u3,"Pérez, ""Bruno""\nJr.",3\r\n',
    );
  });

  it("puts the BOM only once and quotes headers that need it", () => {
    const csv = toCsv(
      [{ id: "x", name: "y" }],
      [
        { header: "a,b", value: (r: Row) => r.id },
        { header: "c", value: (r: Row) => r.name },
      ],
    );
    expect(csv.startsWith(`${CSV_BOM}"a,b",c\r\n`)).toBe(true);
    expect(csv.split(CSV_BOM)).toHaveLength(2);
  });
});

describe("csvStream / csvResponse", () => {
  async function* source(): AsyncGenerator<Row> {
    yield { id: "u1", name: "Ana" };
    yield { id: "u2", name: "Bruno" };
  }

  it("yields the same bytes as toCsv, chunk by chunk, from an async source", async () => {
    const chunks: string[] = [];
    for await (const chunk of csvStream(source(), columns)) chunks.push(chunk);
    expect(chunks).toHaveLength(3); // header (with BOM) + 2 rows
    expect(chunks.join("")).toBe(
      toCsv(
        [
          { id: "u1", name: "Ana" },
          { id: "u2", name: "Bruno" },
        ],
        columns,
      ),
    );
  });

  it("builds a text/csv attachment response that streams the file", async () => {
    const response = await csvResponse("people.csv", source(), columns);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="people.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // EF BB BF is the UTF-8 encoding of the BOM.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(
      `${CSV_BOM}id,nombre,n\r\nu1,Ana,\r\nu2,Bruno,\r\n`,
    );
  });

  async function* failingAt(after: number): AsyncGenerator<Row> {
    for (let i = 0; i < after; i++) yield { id: `u${i}`, name: "Ana" };
    throw new Error("boom: connection lost");
  }

  it("fails like any request when the first rows cannot be read (nothing was sent yet)", async () => {
    await expect(
      csvResponse("people.csv", failingAt(0), columns),
    ).rejects.toThrow("boom: connection lost");
  });

  it("ends a file whose later rows fail with a sentinel comment line, and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await csvResponse("people.csv", failingAt(2), columns);
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        await response.arrayBuffer(),
      );
      expect(text).toBe(
        `${CSV_BOM}id,nombre,n\r\nu0,Ana,\r\nu1,Ana,\r\n${CSV_INTERRUPTED}`,
      );
      expect(CSV_INTERRUPTED.startsWith("#")).toBe(true);
      expect(CSV_INTERRUPTED.endsWith("\r\n")).toBe(true);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("CSV export"),
        expect.objectContaining({ message: "boom: connection lost" }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("still sends a file with only the header when there are no rows", async () => {
    const response = await csvResponse("empty.csv", [], columns);
    expect(await response.text()).toBe("id,nombre,n\r\n");
  });
});
