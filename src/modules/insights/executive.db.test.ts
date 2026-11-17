import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  as,
  direction,
  hr,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { executiveReport } from "./executive";
import { buildReportScenario } from "./test-support";

let s: Scenario;
beforeAll(async () => {
  s = await buildReportScenario();
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

describe("executiveReport", () => {
  it("People, both: every section, unmasked", async () => {
    const r = await executiveReport(db, hr, {
      cycleId: s.c2.cycleId,
      mode: "both",
    });
    expect(r.minGroupSize).toBeNull();
    expect(r.completion.total).toMatchObject({
      participants: 9,
      // The completion module (#59): a side applies to whoever has a request.
      selfSubmitted: 3,
      selfApplicable: 4,
      managerSubmitted: 9,
      managerApplicable: 9,
    });
    // Retention in C2: 2,2,5,3,4,1,2,4,5; engagement: 4,2,5,3,2,1,2,4.
    expect(r.retention).toMatchObject({ n: 9, counts: [1, 3, 1, 2, 2] });
    expect(r.retention?.mean).toBeCloseTo(28 / 9);
    expect(r.engagement).toMatchObject({ n: 8, counts: [1, 3, 1, 2, 1] });
    expect(r.engagement?.mean).toBeCloseTo(23 / 8);
    // Both at or under 2: Bruno, Fabio, Gina.
    expect(r.risk).toEqual({ riskCount: 3, total: 8 });
    expect(r.sentiment).toEqual([
      {
        dimension: "strengths",
        positive: 3,
        constructive: 1,
        negative: 1,
        total: 5,
      },
    ]);
    expect(r.themes?.map((t) => [t.theme, t.count])).toEqual([
      ["calidad", 2],
      ["colaboracion", 2],
    ]);
  });

  it("the mode picks the blocks", async () => {
    const qual = await executiveReport(db, hr, {
      cycleId: s.c2.cycleId,
      mode: "qualitative",
    });
    expect(qual.sentiment).toBeDefined();
    expect(qual.themes).toBeDefined();
    expect(qual.retention).toBeUndefined();
    expect(qual.risk).toBeUndefined();
    const quant = await executiveReport(db, hr, {
      cycleId: s.c2.cycleId,
      mode: "quantitative",
    });
    expect(quant.retention).toBeDefined();
    expect(quant.engagement).toBeDefined();
    expect(quant.sentiment).toBeUndefined();
    expect(quant.themes).toBeUndefined();
    expect(quant.completion.total?.participants).toBe(9);
  });

  it("direction: masked under the minimum group size", async () => {
    const r = await executiveReport(db, direction, {
      cycleId: s.c2.cycleId,
      mode: "both",
    });
    expect(r.minGroupSize).toBe(5);
    expect(r.completion.total?.participants).toBe(9);
    expect(r.retention?.n).toBe(9);
    // The risk quadrant holds 3 people: under 5, its count is hidden.
    expect(r.risk?.riskCount).toBeNull();
    // Comments of only 3 people: nothing qualitative shows.
    expect(r.sentiment).toEqual([]);
    expect(r.themes).toEqual([]);
  });

  it("managers and employees: forbidden", async () => {
    for (const actor of [as(s.id.marta, "manager"), as(s.id.ana, "employee")]) {
      await expect(
        executiveReport(db, actor, { cycleId: s.c2.cycleId, mode: "both" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
