// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/fixtures/serialize/csv";
import {
  inspectReport,
  parseInspectArgs,
  runInspectCli,
  UsageError,
} from "./report-inspect";
import { xlsxFromRows } from "./test-xlsx";

const REPORTS = path.resolve("fixtures/bamboo-reports/small");
const PERFORMANCE = path.join(REPORTS, "employee-performance.csv");

let dir: string | undefined;
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** Every cell of a report that could identify data (headers excluded). */
async function cellsOf(file: string) {
  const [header, ...rows] = parseCsv(await readFile(file, "utf8"));
  return { header, cells: new Set(rows.flat()) };
}

describe("parseInspectArgs", () => {
  it("takes exactly one file of a readable type", () => {
    expect(parseInspectArgs(["a.csv"])).toEqual({ file: "a.csv" });
    expect(() => parseInspectArgs([])).toThrow(UsageError);
    expect(() => parseInspectArgs(["a.csv", "b.csv"])).toThrow(UsageError);
    expect(() => parseInspectArgs(["a.pdf"])).toThrow(UsageError);
    expect(() => parseInspectArgs(["--nope", "a.csv"])).toThrow(UsageError);
  });
});

describe("inspectReport", () => {
  it("counts rows, and per column its non-empty and distinct cells", async () => {
    const report = await inspectReport(PERFORMANCE);
    const { header } = await cellsOf(PERFORMANCE);

    expect(report.fileName).toBe("employee-performance.csv");
    expect(report.sheet).toBeNull();
    expect(report.rows).toBe(119);
    expect(report.columns.map((c) => c.header)).toEqual(header);
    const cycle = report.columns.find((c) => c.header === "Review Cycle")!;
    expect(cycle).toEqual({
      header: "Review Cycle",
      nonEmpty: 119,
      distinct: 5,
    });
  });

  it("reads the first sheet of an xlsx and names it", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "inspect-"));
    const file = path.join(dir, "Assessment Progress.xlsx");
    const rows = parseCsv(
      await readFile(path.join(REPORTS, "assessment-progress.csv"), "utf8"),
    );
    await writeFile(file, xlsxFromRows(rows));

    const report = await inspectReport(file);

    expect(report).toMatchObject({
      fileName: "Assessment Progress.xlsx",
      sheet: "Report",
      rows: rows.length - 1,
    });
  });
});

describe("runInspectCli", () => {
  it("prints headers and counts, never a cell value", async () => {
    const out: string[] = [];
    const code = await runInspectCli([PERFORMANCE], {
      log: (line) => out.push(line),
      error: (line) => out.push(line),
    });
    const text = out.join("\n");
    const { header, cells } = await cellsOf(PERFORMANCE);

    expect(code).toBe(0);
    expect(text).toContain("employee-performance.csv");
    for (const h of header) expect(text).toContain(h);
    // Short codes ("A", "4") and dates could appear inside a header or a
    // count by chance; every other cell must not appear at all.
    const telling = [...cells].filter(
      (c) =>
        c.length > 3 &&
        !/^\d{4}-\d{2}-\d{2}$/.test(c) &&
        !header.some((h) => h.includes(c)),
    );
    expect(telling.length).toBeGreaterThan(50);
    for (const value of telling) expect(text).not.toContain(value);
  });

  it("exits 2 on bad arguments and 1 on a file it cannot read", async () => {
    const quiet = { log: () => {}, error: () => {} };
    expect(await runInspectCli([], quiet)).toBe(2);
    expect(await runInspectCli(["/nope/missing.csv"], quiet)).toBe(1);
  });
});

describe("--values (#83)", () => {
  const RAW = path.join(REPORTS, "assessments-report.csv");
  const STATUS = path.join(REPORTS, "assessment-status.csv");

  it("parses the flag", () => {
    expect(parseInspectArgs(["a.csv", "--values"])).toEqual({
      file: "a.csv",
      values: true,
    });
  });

  it("lists distinct values with counts of the closed columns only", async () => {
    const report = await inspectReport(RAW, { values: true });
    const withValues = report.columns.filter((c) => c.values);
    expect(withValues.map((c) => c.header)).toEqual([
      "Employee - How well does [Company] recognize my value?",
      "Manager - Does [Employee] feel valued? (Performance Score)",
      "Employee - What would help me do my best work?",
      "Manager - How engaged is [Employee]? (Engagement Score)",
    ]);
    const valued = withValues[0].values!;
    expect(valued.map(([v]) => v)).toContain("I feel I am highly valued.");
    expect(valued.reduce((n, [, c]) => n + c, 0)).toBe(withValues[0].nonEmpty);
    // The name inside a retention label is never printed.
    const retention = withValues[1].values!.map(([v]) => v);
    expect(retention).toContain(
      "I would try to convince them to stay. … would be difficult to replace",
    );
  });

  it("prints statuses without who, and no other cell", async () => {
    const lines: string[] = [];
    const code = await runInspectCli([STATUS, "--values"], {
      log: (l) => lines.push(l),
      error: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    const output = lines.join("\n");
    expect(output).toContain("Completed by …");
    expect(output).toContain("Completado");
    const { cells } = await cellsOf(STATUS);
    for (const cell of cells) {
      if (!cell || /^(Completado|En curso|No iniciado)$/.test(cell)) continue;
      expect(output).not.toContain(cell);
    }
  });

  it("prints no values without the flag", async () => {
    const report = await inspectReport(RAW);
    expect(report.columns.some((c) => c.values)).toBe(false);
  });
});
