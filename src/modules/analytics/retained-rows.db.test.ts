import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  historyImportRow,
  identityMatchIssue,
  sourceIdentity,
} from "@/db/schema";
import {
  importReport,
  REPORTS,
  resetDb,
  seedSmallCompany,
} from "@/modules/import-history/test-support";
import { getIndicator, identityRetainedRows } from "./data-quality";

const REPORT = path.join(REPORTS, "assessments-report.csv");

beforeAll(async () => {
  await resetDb();
  const seeded = await seedSmallCompany();
  await db.insert(sourceIdentity).values(
    seeded.company.employees.map((e) => ({
      personId: seeded.personOf.get(e.id)!,
      sourceSystem: "bamboo_api" as const,
      kind: "bamboo_id" as const,
      value: e.id,
    })),
  );
  await importReport(REPORT, "bamboo-assessments-report");
}, 120_000);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("report rows retained by identity (#132)", () => {
  it("lists each open report case with its cycle, the sides and answers it holds back and the file's rows of that cycle", async () => {
    const open = await db
      .select({ id: identityMatchIssue.id })
      .from(identityMatchIssue)
      .where(
        and(
          eq(identityMatchIssue.entity, "assessment"),
          eq(identityMatchIssue.status, "open"),
        ),
      );
    expect(open.length).toBeGreaterThan(0);
    const retained = await identityRetainedRows(db);
    expect(retained.count).toBe(open.length);
    expect(retained.items.map((i) => i.id).sort()).toEqual(
      open.map((o) => o.id).sort(),
    );
    const fileRows = await db
      .select({ cycleId: historyImportRow.cycleId })
      .from(historyImportRow)
      .where(eq(historyImportRow.entity, "assessment"));
    for (const item of retained.items) {
      expect(item.cycleName).toBeTruthy();
      expect(item.workEmail).toMatch(/@/);
      expect(item.sides).toBeGreaterThanOrEqual(1);
      expect(item.sides).toBeLessThanOrEqual(2);
      expect(item.answers).toBeGreaterThan(0);
      expect(item.fileRows).toBe(
        fileRows.filter((r) => r.cycleId === item.cycleId).length,
      );
    }
    expect(await getIndicator(db, "identity_retained_rows")).toEqual(retained);
  });

  it("a case once settled is no longer retained", async () => {
    const [first] = (await identityRetainedRows(db)).items;
    await db
      .update(identityMatchIssue)
      .set({ status: "ignored" })
      .where(eq(identityMatchIssue.id, first.id));
    const after = await identityRetainedRows(db);
    expect(after.items.map((i) => i.id)).not.toContain(first.id);
  });
});
