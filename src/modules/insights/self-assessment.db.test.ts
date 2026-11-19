import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  as,
  direction,
  hr,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { table } from "@/modules/exports/csv-test-support";
import { setSetting } from "@/modules/settings";
import { selfAssessmentReport } from "./self-assessment";
import { buildReportScenario } from "./test-support";

let s: Scenario;
beforeAll(async () => {
  s = await buildReportScenario();
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

const counts = (positive: number, constructive: number, negative: number) => ({
  neutral: 0,
  mixed: 0,
  positive,
  constructive,
  negative,
  total: positive + constructive + negative,
});

describe("selfAssessmentReport", () => {
  it("People: completion, self sentiment and themes, the gap", async () => {
    const r = await selfAssessmentReport(db, hr, {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    expect(r.minGroupSize).toBeNull();
    expect(
      r.completion.groups.map((g) => [
        g.key,
        g.selfSubmitted,
        g.selfApplicable,
      ]),
    ).toEqual([
      // A self assessment applies to whoever has a self request (#59).
      ["Ingeniería", 3, 4],
      ["Producto", 0, 0],
    ]);
    expect(r.sentiment).toEqual([
      { dimension: "strengths", ...counts(2, 0, 1) },
    ]);
    expect(r.themes.map((t) => [t.theme, t.count])).toEqual([
      ["equipo", 2],
      ["calidad", 1],
    ]);
    // Retention: self 5 and 2 (normalized 1 and .25), manager 2 and 2 (.25).
    expect(r.gap).toHaveLength(1);
    expect(r.gap[0].n).toBe(2);
    expect(r.gap[0].meanSelf).toBeCloseTo(0.625);
    expect(r.gap[0].meanManager).toBeCloseTo(0.25);
    expect(r.gap[0].meanGap).toBeCloseTo(-0.375);
    expect(r.sentimentGap).toEqual([
      {
        dimension: "strengths",
        self: counts(2, 0, 1),
        manager: counts(1, 1, 0),
      },
    ]);
  });

  it("a manager: only their direct reports", async () => {
    const r = await selfAssessmentReport(db, as(s.id.nora, "manager"), {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    expect(r.completion.groups.map((g) => g.key)).toEqual(["Producto"]);
    expect(r.sentiment).toEqual([]);
    expect(r.gap).toEqual([]);
  });

  it("direction: only groups of at least the minimum, no quotes", async () => {
    const masked = await selfAssessmentReport(db, direction, {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    expect(masked.minGroupSize).toBe(5);
    expect(masked.completion.groups.map((g) => g.key)).toEqual(["Ingeniería"]);
    expect(masked.completion.suppressed).toBe(3);
    // 3 people wrote a self comment: under 5, nothing shows.
    expect(masked.sentiment).toEqual([]);
    expect(masked.themes).toEqual([]);
    expect(masked.gap).toEqual([]);

    await setSetting(db, hr, "aggregation.minGroupSize", 2);
    const open = await selfAssessmentReport(db, direction, {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    await setSetting(db, hr, "aggregation.minGroupSize", 5);
    expect(open.sentiment).toEqual([
      { dimension: "strengths", ...counts(2, 0, 1) },
    ]);
    expect(open.themes.every((t) => t.quotes.length === 0)).toBe(true);
    expect(open.gap.map((g) => g.n)).toEqual([2]);
  });

  it("an employee: forbidden", async () => {
    await expect(
      selfAssessmentReport(db, as(s.id.ana, "employee"), {
        cycleId: s.c2.cycleId,
        groupBy: "department",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("exports insights-self-assessment.csv (long format)", async () => {
    const { header, rows } = await table(
      "insights-self-assessment.csv",
      `?cycle=${s.c2.cycleId}&locale=en`,
    );
    expect(header).toEqual(["section", "group", "metric", "value"]);
    expect(rows).toContainEqual({
      section: "completion",
      group: "Ingeniería",
      metric: "self_submitted",
      value: "3",
    });
    expect(rows).toContainEqual({
      section: "sentiment",
      group: "strengths",
      metric: "negative",
      value: "1",
    });
    expect(rows).toContainEqual({
      section: "completion",
      group: "Total",
      metric: "n",
      value: "9",
    });
    expect(rows).toContainEqual({
      section: "sentiment_gap",
      group: "strengths:manager",
      metric: "constructive",
      value: "1",
    });
    expect(rows).toContainEqual({
      section: "theme",
      group: "equipo",
      metric: "count",
      value: "2",
    });
  });
});
