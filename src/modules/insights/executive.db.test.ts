import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  as,
  direction,
  hr,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { insertEngagement } from "@/modules/engagement/test-support";
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
    expect(r.risk).toMatchObject({ riskCount: 3, total: 8, atRisk: null });
    expect(r.risk?.cells).toHaveLength(9);
    // The open-text reading per person (#129): one row per question and side.
    expect(r.substance?.length).toBeGreaterThan(0);
    expect(r.signals?.people).toBeGreaterThan(0);
    expect(r.themes?.map((t) => [t.theme, t.count])).toEqual([
      ["calidad", 2],
      ["equipo", 2],
    ]);
  });

  it("the mode picks the blocks", async () => {
    const qual = await executiveReport(db, hr, {
      cycleId: s.c2.cycleId,
      mode: "qualitative",
    });
    expect(qual.substance).toBeDefined();
    expect(qual.themes).toBeDefined();
    expect(qual.retention).toBeUndefined();
    expect(qual.risk).toBeUndefined();
    const quant = await executiveReport(db, hr, {
      cycleId: s.c2.cycleId,
      mode: "quantitative",
    });
    expect(quant.retention).toBeDefined();
    expect(quant.engagement).toBeDefined();
    expect(quant.substance).toBeUndefined();
    // Goal KPIs (#62): the scenario's people have no goals in the period.
    expect(quant.goals).toMatchObject({
      people: 9,
      goals: 0,
      completedPct: null,
    });
    expect(qual.goals).toBeUndefined();
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
    expect(r.substance).toEqual([]);
    expect(r.signals).toBeNull();
    expect(r.themes).toEqual([]);
  });

  it("shows the latest month of the monthly engagement in the quantitative blocks only", async () => {
    const quantSection = async (actor = hr) =>
      executiveReport(db, actor, {
        cycleId: s.c2.cycleId,
        mode: "quantitative",
      });
    expect((await quantSection()).engagementMonthly).toBeNull();

    const people = [
      s.id.ana,
      s.id.bruno,
      s.id.carla,
      s.id.dario,
      s.id.elena,
      s.id.fabio,
    ];
    for (const [i, personId] of people.entries()) {
      await insertEngagement({
        personId,
        month: "2024-11-01",
        score: 0.5,
        segment: "regular",
      });
      await insertEngagement({
        personId,
        month: "2024-12-01",
        score: i < 3 ? 0.9 : 0.7,
        segment: i < 3 ? "alto" : "medio",
      });
    }

    // #133: a month after the cycle's period (H2 2024) is not its month.
    await insertEngagement({
      personId: s.id.ana,
      month: "2026-02-01",
      score: 0.1,
      segment: "bajo",
    });
    const r = await quantSection();
    expect(r.engagementMonthly?.latest).toMatchObject({
      month: "2024-12-01",
      people: 6,
      segments: { alto: 3, medio: 3 },
    });
    expect(r.engagementMonthly?.latest.mean).toBeCloseTo(0.8);
    expect(r.engagementMonthly?.previous?.mean).toBeCloseTo(0.5);
    const qual = await executiveReport(db, hr, {
      cycleId: s.c2.cycleId,
      mode: "qualitative",
    });
    expect(qual.engagementMonthly).toBeUndefined();
    // Direction: six people reach the minimum of 5, the cells of 3 do not need to.
    const masked = await quantSection(direction);
    expect(masked.engagementMonthly?.latest).toMatchObject({
      hidden: false,
      people: 6,
    });
    // ... but under it the month is hidden.
    const strict = await executiveReport(db, direction, {
      cycleId: s.c2.cycleId,
      mode: "quantitative",
      minGroupSize: 7,
    });
    expect(strict.engagementMonthly?.latest.hidden).toBe(true);
  });

  it("managers and employees: forbidden", async () => {
    for (const actor of [as(s.id.marta, "manager"), as(s.id.ana, "employee")]) {
      await expect(
        executiveReport(db, actor, { cycleId: s.c2.cycleId, mode: "both" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
