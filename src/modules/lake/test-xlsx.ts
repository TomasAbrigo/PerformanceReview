import { strToU8, zipSync } from "fflate";

/**
 * Tests only: a minimal one-sheet .xlsx from rows of text, shaped like
 * Excel writes it (strings in sharedStrings; `yyyy-mm-dd` cells as date
 * serials with a date style), so a report can be imported as a workbook.
 */
export function xlsxFromRows(rows: string[][]): Uint8Array {
  const shared: string[] = [];
  const index = new Map<string, number>();
  const sharedIndex = (text: string) => {
    let i = index.get(text);
    if (i === undefined) {
      i = shared.length;
      shared.push(text);
      index.set(text, i);
    }
    return i;
  };
  const column = (n: number): string =>
    n < 26
      ? String.fromCharCode(65 + n)
      : column(Math.floor(n / 26) - 1) + column(n % 26);
  const escape = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${column(c)}${r + 1}`;
          if (value === "") return "";
          if (r > 0 && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const serial =
              (Date.parse(`${value}T00:00:00Z`) -
                Date.parse("1899-12-30T00:00:00Z")) /
              86_400_000;
            return `<c r="${ref}" s="1"><v>${serial}</v></c>`;
          }
          return `<c r="${ref}" t="s"><v>${sharedIndex(value)}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns =
    'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const rel =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  return zipSync({
    "[Content_Types].xml": strToU8(
      `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${type}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${type}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${type}.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="${type}.sharedStrings+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `${xml}<workbook ${ns} xmlns:r="${rel}"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(
      `${xml}<styleSheet ${ns}><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `${xml}<sst ${ns} count="${shared.length}" uniqueCount="${shared.length}">${shared
        .map((t) => `<si><t xml:space="preserve">${escape(t)}</t></si>`)
        .join("")}</sst>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `${xml}<worksheet ${ns}><sheetData>${body}</sheetData></worksheet>`,
    ),
  });
}
