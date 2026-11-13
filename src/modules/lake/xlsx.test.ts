// @vitest-environment node
import { strToU8, zipSync } from "fflate";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { xlsxToCsv } from "./xlsx";

/** `raw` is a numeric cell written digit by digit (a JS number would round). */
type Cell =
  string | number | boolean | { date: number } | { raw: string } | null;

const COLUMNS = "ABCDEFGH";

/**
 * Minimal but Excel-shaped workbook: text through sharedStrings, dates as
 * serial numbers with a date style, booleans, blanks, and a second sheet.
 */
function buildXlsx(sheet1: Cell[][], sheet2: Cell[][] = [["ignored"]]) {
  const shared: string[] = [];
  const sharedIndex = (text: string) => {
    const known = shared.indexOf(text);
    if (known >= 0) return known;
    shared.push(text);
    return shared.length - 1;
  };
  const sheetXml = (rows: Cell[][]) => {
    const body = rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            const ref = `${COLUMNS[c]}${r + 1}`;
            if (cell === null) return "";
            if (typeof cell === "string") {
              return `<c r="${ref}" t="s"><v>${sharedIndex(cell)}</v></c>`;
            }
            if (typeof cell === "boolean") {
              return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
            }
            if (typeof cell === "number") {
              return `<c r="${ref}"><v>${cell}</v></c>`;
            }
            if ("raw" in cell) {
              return `<c r="${ref}"><v>${cell.raw}</v></c>`;
            }
            // date: style 1 = date only (numFmt 14), style 2 = date + time (22)
            const style = Number.isInteger(cell.date) ? 1 : 2;
            return `<c r="${ref}" s="${style}"><v>${cell.date}</v></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  };
  const sheet1Xml = sheetXml(sheet1);
  const sheet2Xml = sheetXml(sheet2);
  const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
    .map(
      (text) =>
        `<si><t xml:space="preserve">${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</t></si>`,
    )
    .join("")}</sst>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
    "xl/sharedStrings.xml": strToU8(sharedXml),
    "xl/worksheets/sheet1.xml": strToU8(sheet1Xml),
    "xl/worksheets/sheet2.xml": strToU8(sheet2Xml),
  });
}

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
});
async function dirWith(files: Record<string, Uint8Array | string>) {
  const dir = await mkdtemp(join(tmpdir(), "lake-xlsx-test-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}
const conversions = async () =>
  (await readdir(tmpdir())).filter((name) => name.startsWith("lake-xlsx-conv"));

// 46023 = 2026-01-01 (Excel serial); .5 = noon.
const REPORT: Cell[][] = [
  ["id", "name", "active", "hired", "seen", "notes"],
  [
    { raw: "9007199254740993" },
    "Ana, López",
    true,
    { date: 46023 },
    { date: 46023.5 },
    "line 1\nline 2",
  ],
  [2, 'José "Pepe" Díaz', false, null, null, null],
  [null, null, null, null, null, null],
];

describe("xlsxToCsv", () => {
  it("turns the first sheet into csv: header row, typed cells, exact numbers", async () => {
    const dir = await dirWith({ "report.xlsx": buildXlsx(REPORT) });

    const csv = await xlsxToCsv(join(dir, "report.xlsx"));

    expect(csv).toBe(
      [
        "id,name,active,hired,seen,notes",
        '9007199254740993,"Ana, López",true,2026-01-01,2026-01-01T12:00:00.000Z,"line 1\nline 2"',
        '2,"José ""Pepe"" Díaz",false,,,',
        "",
      ].join("\n"),
    );
  });

  it("explains what is wrong when the file is not a workbook", async () => {
    const dir = await dirWith({ "broken.xlsx": "this is not a zip" });

    await expect(xlsxToCsv(join(dir, "broken.xlsx"))).rejects.toThrow(
      /broken\.xlsx.*xlsx/i,
    );
  });
});

describe("DuckDbFileLake over xlsx files", () => {
  it("serves an .xlsx as a table of text: every cell exactly as written, blanks as null", async () => {
    const dir = await dirWith({
      "report.xlsx": buildXlsx(REPORT),
      "plain.csv": "id\n1\n",
    });
    const lake = await DuckDbFileLake.open(dir);

    const columns = await lake.describeTable("report");
    const rows = [];
    for await (const batch of lake.readBatches("report", {
      keyColumns: ["id"],
    })) {
      rows.push(...batch.rows);
    }

    expect(await lake.listTables()).toEqual(["plain", "report"]);
    // No type inference: a csv would guess BIGINT/BOOLEAN/DATE here.
    expect(columns.map((c) => c.type)).toEqual(Array(6).fill("VARCHAR"));
    expect(rows).toEqual([
      {
        id: "2",
        name: 'José "Pepe" Díaz',
        active: "false",
        hired: null,
        seen: null,
        notes: null,
      },
      {
        id: "9007199254740993",
        name: "Ana, López",
        active: "true",
        hired: "2026-01-01",
        seen: "2026-01-01T12:00:00.000Z",
        notes: "line 1\nline 2",
      },
    ]);
    await lake.close();
  });

  it("does not let type inference touch numbers: a mixed column keeps every digit", async () => {
    // A csv sniffer would make this column DOUBLE: 12.50 -> 12.5 and the long
    // id would round to ...992.
    const dir = await dirWith({
      "t.xlsx": buildXlsx([
        ["id", "amount"],
        [{ raw: "1" }, { raw: "12.50" }],
        [{ raw: "2" }, { raw: "9007199254740993" }],
        [{ raw: "3" }, { raw: "0.10" }],
      ]),
    });
    const lake = await DuckDbFileLake.open(dir);

    const rows = [];
    for await (const batch of lake.readBatches("t", { keyColumns: ["id"] })) {
      rows.push(...batch.rows);
    }

    expect(rows).toEqual([
      { id: "1", amount: "12.50" },
      { id: "2", amount: "9007199254740993" },
      { id: "3", amount: "0.10" },
    ]);
    await lake.close();
  });

  it("removes its temporary csv conversions on close", async () => {
    const dir = await dirWith({ "report.xlsx": buildXlsx(REPORT) });
    const before = await conversions();

    const lake = await DuckDbFileLake.open(dir);
    expect(await conversions()).toHaveLength(before.length + 1);
    await lake.close();

    expect(await conversions()).toEqual(before);
  });

  it("refuses an .xlsx and a .csv that claim the same table", async () => {
    const dir = await dirWith({
      "report.xlsx": buildXlsx(REPORT),
      "report.csv": "id\n1\n",
    });

    await expect(DuckDbFileLake.open(dir)).rejects.toThrow(
      /ambiguous.*report/i,
    );
  });
});
