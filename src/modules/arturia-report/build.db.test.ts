import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { generateCompany } from "@/fixtures/company";
import {
  importReport,
  REPORTS,
  resetDb,
  seedSmallCompany,
} from "@/modules/import-history/test-support";
import { MockProvider } from "@/modules/qualitative-analysis/mock-provider";
import { runAnalysis } from "@/modules/qualitative-analysis/service";
import { buildReport, resolveCycle } from "./build";
import { runExportCli } from "./cli";
import { renderHtml, renderJson } from "./render";
import { arturiaReportV1, type ArturiaReport } from "./schema";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u;
const MIN = 5;

/** Display names (and their parts of 4+ letters) of the seed company. */
const company = generateCompany({ size: "small", seed: 1001 });
const names = company.employees.map((e) => `${e.firstName} ${e.lastName}`);

/** Every group of every series of the report, with its n. */
function groupSizes(r: ArturiaReport): { label: string; n: number }[] {
  const s = r.sections;
  return [
    ...s.executive.byDepartment,
    ...(s.completion?.byDepartment ?? []),
    ...(s.completion?.byManager ?? []),
    ...(s.indicators?.distribution.flatMap((d) => d.groups) ?? []),
    ...(s.goals?.byDepartment ?? []),
  ];
}

let cycleId: string;

beforeAll(async () => {
  await resetDb();
  await db.execute(sql`TRUNCATE analysis_run, theme, app_setting CASCADE`);
  await seedSmallCompany();
  await importReport(path.join(REPORTS, "employee-performance.csv"));
  await runAnalysis(db, { provider: new MockProvider() });
  cycleId = (await resolveCycle(db, "latest")).id;
}, 120_000);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("buildReport over the seed small company", () => {
  it("builds a valid named report with people, emails and all base sections", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    expect(arturiaReportV1.safeParse(r).success).toBe(true);
    expect(r.schemaVersion).toBe("arturia-report.v1");
    expect(r.anonymized).toBe(false);
    expect(r.sections.executive.participants).toBeGreaterThan(0);
    expect(r.sections.completion).not.toBeNull();
    expect(r.sections.indicators?.distribution).toHaveLength(2);
    expect(r.sections.indicators?.riskMatrix?.cells).toHaveLength(9);
    expect(r.sections.qualitative?.topThemes.length).toBeGreaterThan(0);
    expect(r.sections.people?.length).toBe(r.sections.executive.participants);
    // The named report carries personal data: emails and names.
    expect(renderJson(r)).toMatch(EMAIL);
    expect(names.some((n) => renderJson(r).includes(n))).toBe(true);
  });

  it("the anonymized report has no emails, no seed names and no group under the minimum", async () => {
    const r = await buildReport(db, {
      cycle: cycleId,
      anonymized: true,
      minGroupSize: MIN,
    });
    expect(arturiaReportV1.safeParse(r).success).toBe(true);
    expect(r.sections.people).toBeNull();
    for (const text of [renderJson(r), renderHtml(r)]) {
      expect(text).not.toMatch(EMAIL);
      const folded = text.normalize("NFC");
      for (const n of names) expect(folded).not.toContain(n);
      // last names alone (the quotes are pseudonymized: no surname survives)
      for (const e of company.employees) {
        if (e.lastName.length >= 5) {
          expect(folded).not.toMatch(
            new RegExp(`(?<![\\p{L}])${e.lastName}(?![\\p{L}])`, "u"),
          );
        }
      }
    }
    const sizes = groupSizes(r);
    expect(sizes.length).toBeGreaterThan(0);
    for (const g of sizes) expect(g.n).toBeGreaterThanOrEqual(MIN);
    for (const g of r.sections.completion?.byManager ?? []) {
      expect(g.label).toMatch(/^(Equipo \d+|Otros)$/);
    }
  });

  it.each([2, MIN, 8, 40])(
    "with minimum %i no total sits next to a suppressed group (no differencing)",
    async (min) => {
      const r = await buildReport(db, {
        cycle: cycleId,
        anonymized: true,
        minGroupSize: min,
      });
      const s = r.sections;
      if (s.executive.suppressed > 0)
        expect(s.executive.distribution).toBeNull();
      const c = s.completion!;
      if (c.suppressed.byDepartment + c.suppressed.byManager > 0) {
        expect(c.byRelationship).toBeNull();
      }
      for (const g of [...c.byDepartment, ...c.byManager]) {
        expect(g.n).toBeGreaterThanOrEqual(min);
        expect(g.n).toBeLessThanOrEqual(s.executive.participants);
      }
      for (const d of s.indicators?.distribution ?? []) {
        if (d.suppressed > 0) expect(d.total).toBeNull();
        for (const g of d.groups) expect(g.n).toBeGreaterThanOrEqual(min);
      }
      const m = s.indicators?.riskMatrix;
      if (m?.cells.some((x) => x.count === null)) {
        expect(m.total).toBeNull();
        // riskCount is the risk cell itself, masked like any other cell
        expect(m.riskCount).toBe(m.cells.find((x) => x.risk)!.count);
      }
      if (min === 40) {
        // everything is under 40: the suppression path is really exercised
        expect(c.byRelationship).toBeNull();
        expect(c.byDepartment).toEqual([]);
      }
    },
  );

  it("the CLI writes both files (named and anonymized) and prints no names", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "arturia-"));
    try {
      const out: string[] = [];
      for (const extra of [[], ["--anonymized"]]) {
        const code = await runExportCli(
          ["--cycle", "latest", "--out", dir, ...extra],
          { db, stdout: (l) => out.push(l) },
        );
        expect(code).toBe(0);
      }
      const json = JSON.parse(
        await readFile(path.join(dir, "report.anonymized.json"), "utf8"),
      );
      expect(arturiaReportV1.safeParse(json).success).toBe(true);
      await readFile(path.join(dir, "report.html"), "utf8");
      const printed = out.join("\n");
      for (const n of names) expect(printed).not.toContain(n);
      expect(printed).not.toMatch(EMAIL);

      const errors: string[] = [];
      expect(
        await runExportCli(["--cycle", "nope"], {
          db,
          stderr: (l) => errors.push(l),
        }),
      ).toBe(1);
      expect(await runExportCli([], { db, stderr: () => {} })).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("defaults to data/private/arturia/<cycle-slug>/ under the working directory", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "arturia-cwd-"));
    try {
      const out: string[] = [];
      expect(
        await runExportCli(["--cycle", cycleId], {
          db,
          cwd,
          stdout: (l) => out.push(l),
        }),
      ).toBe(0);
      expect(out[1].trim()).toMatch(
        new RegExp(`^${cwd}/data/private/arturia/[a-z0-9-]+/report\\.json$`),
      );
      await readFile(out[1].trim(), "utf8");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
