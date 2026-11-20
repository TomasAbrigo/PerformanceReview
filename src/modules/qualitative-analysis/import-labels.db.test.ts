import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  importReport,
  REPORTS,
  resetDb,
  seedSmallCompany,
} from "@/modules/import-history/test-support";
import { importLabels } from "./import-labels";
import { MockProvider } from "./mock-provider";
import { runAnalysis } from "./service";

const LABELS = path.resolve("fixtures/qualitative-labels/small.csv");

beforeAll(async () => {
  await resetDb();
  await db.execute(sql`TRUNCATE analysis_run, theme CASCADE`);
  await seedSmallCompany();
  await importReport(path.join(REPORTS, "employee-performance.csv"));
}, 60_000);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("importLabels (synthetic fixture CSV)", () => {
  it("matches rows by text hash (or cycle + dimension) and returns the unmatched ones", async () => {
    const result = await importLabels(db, { csvPath: LABELS });
    expect(result.total).toBe(6);
    expect(result.matched).toBe(5);
    expect(result.unmatched).toEqual([
      {
        line: 6,
        employee: "Persona Inexistente",
        cycle: "Evaluación semestral 2024-H1",
        reason: "unknown_person",
      },
    ]);
    const labels = await db.execute<{
      sentiment: string;
      themes: string[];
      dimension: string;
    }>(sql`
      select sentiment, themes, dimension from qualitative_analysis
      where provider = 'import' order by sentiment, dimension`);
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(labels).toContainEqual({
      sentiment: "constructive",
      themes: ["comunicacion"],
      dimension: "improvement",
    });
    const [run] = await db.execute<Record<string, unknown>>(
      sql`select provider, status, texts_total, texts_analyzed from analysis_run where provider = 'import'`,
    );
    expect(run).toEqual({
      provider: "import",
      status: "succeeded",
      texts_total: 6,
      texts_analyzed: 5,
    });
  });

  it("re-importing is idempotent and runs the mock over the imported cycle", async () => {
    await importLabels(db, { csvPath: LABELS });
    const [{ n }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from qualitative_analysis where provider = 'import'`,
    );
    expect(n).toBeLessThan(10);
    const r = await runAnalysis(db, { provider: new MockProvider() });
    expect(r.total).toBeGreaterThan(50);
    expect(r.analyzed).toBe(r.total);
  });

  it("falls back to cycle + dimension, and never guesses between two answers", async () => {
    const r = await importLabels(db, {
      rows: [
        {
          employee_name: "adrian bustos",
          review_cycle: "Evaluación semestral 2024-H1",
          dimension: "strengths",
          sentiment: "positive",
        },
        {
          employee_name: "Adrián Bustos",
          review_cycle: "Otro ciclo",
          text: "x",
          sentiment: "positive",
        },
        {
          employee_name: "Adrián Bustos",
          review_cycle: "Evaluación semestral 2024-H1",
          text: "x",
          sentiment: "feliz",
        },
      ],
    });
    expect(r.unmatched.map((u) => u.reason)).toEqual([
      "ambiguous",
      "unknown_cycle",
      "invalid_sentiment",
    ]);
  });

  it("rejects a CSV without the required columns", async () => {
    await expect(importLabels(db, { csv: "a,b\n1,2\n" })).rejects.toThrow(
      /invalid_csv/,
    );
  });
});
