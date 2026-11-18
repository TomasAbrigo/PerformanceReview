import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { engagementMonthly, identityMatchIssue } from "@/db/schema";
import { insertPerson, resetAll } from "@/modules/analytics/test-support";
import { resolveIssue } from "@/modules/identity";
import { writeCsv } from "@/modules/import-history/test-support";
import { importReportFile } from "@/modules/lake/upload";
import { setSetting } from "@/modules/settings";

const HEADER = "EEID,Nombre,Mes,Score,Segmento";
const importWith = (header: string, lines: string[]) =>
  writeCsv([header, ...lines]).then((path) =>
    importReportFile(db, { path, profile: "engagement-monthly" }),
  );
const importFile = (lines: string[]) => importWith(HEADER, lines);

let ana: string;
let bruno: string;

beforeEach(async () => {
  await resetAll();
  await db.execute(
    (await import("drizzle-orm"))
      .sql`delete from app_setting where key like 'engagement.%'`,
  );
  ana = await insertPerson({ displayName: "Ana Prieto", bambooId: "11" });
  bruno = await insertPerson({ displayName: "Bruno Soler", bambooId: "12" });
});
afterAll(async () => {
  await resetAll();
  await closeDb();
});

const rowsOf = (personId: string) =>
  db
    .select()
    .from(engagementMonthly)
    .where(eq(engagementMonthly.personId, personId))
    .orderBy(asc(engagementMonthly.month));

describe("importing the monthly engagement file", () => {
  it("writes one row per person and month, with the file's segment", async () => {
    const result = await importFile([
      "11,Ana Prieto,2026-01,0.85,Alto",
      "11,Ana Prieto,2026-02,0.55,Regular",
      "12,Bruno Soler,2026-01,,Falta",
    ]);

    expect(result.status ?? "succeeded").toBe("succeeded");
    expect(result.counts).toMatchObject({ read: 3, inserted: 3, rejected: 0 });
    expect(
      (await rowsOf(ana)).map((r) => [r.month, r.score, r.segment]),
    ).toEqual([
      ["2026-01-01", "0.8500", "alto"],
      ["2026-02-01", "0.5500", "regular"],
    ]);
    expect(
      (await rowsOf(bruno)).map((r) => [r.month, r.score, r.segment]),
    ).toEqual([["2026-01-01", null, "falta"]]);
  });

  it("derives the segment from the score with the default cutoffs when the file has none", async () => {
    const result = await importWith("EEID,Mes,Score", [
      "11,2026-01,0.8",
      "11,2026-02,0.6",
      "11,2026-03,0.4",
      "11,2026-04,0.39",
    ]);

    expect(result.counts).toMatchObject({ inserted: 4, rejected: 0 });
    expect((await rowsOf(ana)).map((r) => r.segment)).toEqual([
      "alto",
      "medio",
      "regular",
      "bajo",
    ]);
  });

  it("uses the cutoffs of the settings", async () => {
    const hr = { personId: ana, role: "hr" } as const;
    await setSetting(db, hr, "engagement.cutoffAlto", 90);
    await setSetting(db, hr, "engagement.cutoffMedio", 70);
    await setSetting(db, hr, "engagement.cutoffRegular", 50);

    await importWith("EEID,Mes,Score", ["11,2026-01,0.85", "11,2026-02,0.45"]);

    expect((await rowsOf(ana)).map((r) => r.segment)).toEqual([
      "medio",
      "bajo",
    ]);
  });

  it("reads MM/YYYY months and treats the same month, written two ways, as one row", async () => {
    await importFile(["11,Ana Prieto,03/2026,0.7,Medio"]);
    const again = await importFile(["11,Ana Prieto,2026-03,0.7,Medio"]);

    expect(again.counts).toMatchObject({ inserted: 0, unchanged: 1 });
    expect((await rowsOf(ana)).map((r) => r.month)).toEqual(["2026-03-01"]);
  });

  it("is idempotent, and a corrected score or segment updates the month", async () => {
    await importFile(["11,Ana Prieto,2026-01,0.5,Regular"]);
    const same = await importFile(["11,Ana Prieto,2026-01,0.5,Regular"]);
    expect(same.counts).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 1,
    });

    const fixed = await importFile(["11,Ana Prieto,2026-01,0.9,Alto"]);
    expect(fixed.counts).toMatchObject({ inserted: 0, updated: 1 });
    expect((await rowsOf(ana)).map((r) => [r.score, r.segment])).toEqual([
      ["0.9000", "alto"],
    ]);
  });

  it("never deletes the months a later file does not list", async () => {
    await importFile([
      "11,Ana Prieto,2026-01,0.5,Regular",
      "11,Ana Prieto,2026-02,0.6,Medio",
    ]);
    await importFile(["11,Ana Prieto,2026-03,0.7,Medio"]);

    expect((await rowsOf(ana)).map((r) => r.month)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });

  it("rejects the rows that are not valid and imports the others", async () => {
    const result = await importFile([
      "11,Ana Prieto,2026-01,0.5,Regular",
      "11,Ana Prieto,2026-02,1.5,Alto",
      "11,Ana Prieto,marzo,0.5,Regular",
      "11,Ana Prieto,2026-04,,",
      ",Ana Prieto,2026-05,0.5,Regular",
    ]);

    expect(result.counts).toMatchObject({ read: 5, inserted: 1, rejected: 4 });
    expect(await rowsOf(ana)).toHaveLength(1);
  });

  it("refuses a file without the Mes column", async () => {
    await expect(importWith("EEID,Score", ["11,0.5"])).rejects.toThrow(/Mes/);
  });

  it("sends an EEID that matches nobody to the identity queue, and imports it once linked", async () => {
    const result = await importFile(["99,Zoe Nadie,2026-01,0.75,Medio"]);
    expect(result.counts).toMatchObject({ read: 1, inserted: 0, issues: 1 });
    const issues = await db
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.entity, "engagement_monthly"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      status: "open",
      reason: "no_match",
      sourceId: JSON.stringify(["99", "2026-01-01"]),
    });

    const zoe = await insertPerson({ displayName: "Zoe Nadie" });
    await resolveIssue(db, issues[0].id, { action: "link", personId: zoe });

    expect(
      (await rowsOf(zoe)).map((r) => [r.month, r.score, r.segment]),
    ).toEqual([["2026-01-01", "0.7500", "medio"]]);
    const again = await importFile(["99,Zoe Nadie,2026-01,0.75,Medio"]);
    expect(again.counts).toMatchObject({ issues: 0, unchanged: 1 });
  });

  it("matches the EEID once the person arrives and closes the issue", async () => {
    const line = "77,Nuevo Ingreso,2026-01,0.6,Medio";
    await importFile([line]);
    const nuevo = await insertPerson({
      displayName: "Nuevo Ingreso",
      bambooId: "77",
    });

    const again = await importFile([line]);

    expect(again.counts).toMatchObject({ inserted: 1, issues: 0 });
    expect(await rowsOf(nuevo)).toHaveLength(1);
    const [issue] = await db
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.entity, "engagement_monthly"));
    expect(issue.status).toBe("resolved");
  });
});
