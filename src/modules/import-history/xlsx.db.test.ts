import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { assessmentProgress, reviewCycle } from "@/db/schema";
import { parseCsv } from "@/fixtures/serialize/csv";
import { xlsxFromRows } from "@/modules/lake/test-xlsx";
import {
  importUpload,
  storeUpload,
  type UploadStore,
} from "@/modules/lake/upload";
import {
  REPORTS,
  resetDb,
  seedSmallCompany,
  type SeededCompany,
} from "./test-support";

/** Both Bamboo reports exported as .xlsx import like their CSV (#58). */

let root: string;
let store: UploadStore;
let seeded: SeededCompany;

beforeAll(async () => {
  await resetDb();
  seeded = await seedSmallCompany();
  root = await mkdtemp(path.join(tmpdir(), "xlsx-history-"));
  store = {
    uploadsDir: path.join(root, "uploads"),
    profilesDir: path.join(root, "profiles"),
  };
}, 60_000);
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await resetDb();
  await closeDb();
});

async function importXlsx(report: string, profile: string) {
  const rows = parseCsv(
    await readFile(path.join(REPORTS, `${report}.csv`), "utf8"),
  );
  const stored = await storeUpload(
    { name: `${report}.xlsx`, bytes: Buffer.from(xlsxFromRows(rows)) },
    store,
  );
  const result = await importUpload({
    uploadId: stored.id,
    fileName: `${report}.xlsx`,
    profile: { builtin: profile },
    db,
    store,
  });
  return { ...result, rows: rows.length - 1 };
}

describe("importing the small reports as xlsx", () => {
  it("Employee Performance creates the semi-annual cycles; Assessment Progress fills their completion", async () => {
    const performance = await importXlsx(
      "employee-performance",
      "bamboo-employee-performance",
    );
    expect(performance.mode).toBe("domain");
    expect(performance.counts).toMatchObject({
      read: performance.rows,
      rejected: 0,
    });
    expect(performance.counts.inserted + (performance.counts.issues ?? 0)).toBe(
      performance.rows,
    );
    const cycles = await db.select().from(reviewCycle);
    expect(cycles.map((c) => c.name).sort()).toEqual(
      seeded.company.cycles.map((c) => c.name),
    );
    for (const cycle of cycles) {
      const fixture = seeded.company.cycles.find((c) => c.name === cycle.name)!;
      // A named cycle: its period spans its assessment window.
      expect(cycle.periodStart >= fixture.assessmentOpen).toBe(true);
      expect(cycle.periodEnd <= fixture.assessmentDue).toBe(true);
    }

    const progress = await importXlsx(
      "assessment-progress",
      "bamboo-assessment-progress",
    );
    expect(progress.status).toBe("succeeded");
    expect(progress.counts).toMatchObject({
      read: progress.rows,
      rejected: 0,
    });
    expect(progress.counts.deferred ?? 0).toBe(0);
    expect(await db.$count(assessmentProgress)).toBe(progress.counts.inserted);
    expect(progress.counts.inserted).toBeGreaterThan(progress.rows / 2);

    // The same workbook again: nothing new.
    const again = await importXlsx(
      "assessment-progress",
      "bamboo-assessment-progress",
    );
    expect(again.counts).toMatchObject({ inserted: 0, updated: 0 });
    expect(await db.$count(assessmentProgress)).toBe(progress.counts.inserted);
  }, 120_000);
});
