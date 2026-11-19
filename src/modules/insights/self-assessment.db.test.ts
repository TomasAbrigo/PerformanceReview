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
    // The open-text reading per person (#129): self strengths of 3 people.
    expect(r.substance.find((x) => x.dimension === "strengths")?.people).toBe(
      3,
    );
    const strengths = r.themes.find((t) => t.dimension === "strengths");
    expect(strengths?.people.self).toBeGreaterThan(0);
    // Retention: self 5 and 2 (normalized 1 and .25), manager 2 and 2 (.25).
    expect(r.gap).toHaveLength(1);
    expect(r.gap[0].n).toBe(2);
    expect(r.gap[0].meanSelf).toBeCloseTo(0.625);
    expect(r.gap[0].meanManager).toBeCloseTo(0.25);
    expect(r.gap[0].meanGap).toBeCloseTo(-0.375);
  });

  it("a manager: only their direct reports", async () => {
    const r = await selfAssessmentReport(db, as(s.id.nora, "manager"), {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    expect(r.completion.groups.map((g) => g.key)).toEqual(["Producto"]);
    expect(r.substance).toEqual([]);
    expect(r.gap).toEqual([]);
  });

  it("direction: only groups of at least the minimum, no quotes", async () => {
    const masked = await selfAssessmentReport(db, direction, {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    expect(masked.minGroupSize).toBe(5);
    // Producto (3) cannot hide next to the total (#130): all in Otros.
    expect(masked.completion.groups).toEqual([]);
    expect(masked.completion.others).toMatchObject({ participants: 9 });
    expect(masked.completion.suppressed).toBe(0);
    // 3 people wrote a self comment: under 5, nothing shows.
    expect(masked.substance).toEqual([]);
    expect(masked.themes.every((t) => t.rows.length === 0)).toBe(true);
    expect(masked.gap).toEqual([]);

    await setSetting(db, hr, "aggregation.minGroupSize", 2);
    const open = await selfAssessmentReport(db, direction, {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    await setSetting(db, hr, "aggregation.minGroupSize", 5);
    expect(
      open.substance.find((x) => x.dimension === "strengths")?.people,
    ).toBe(3);
    expect(
      open.themes.every((t) =>
        t.rows.every((x) => !x.quotes.self.length && !x.quotes.manager.length),
      ),
    ).toBe(true);
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
      section: "completion",
      group: "Total",
      metric: "n",
      value: "9",
    });
    // The open-text reading, in people, from the same report as the screen;
    // the old sentiment-by-answer sections are gone.
    const report = await selfAssessmentReport(db, hr, {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    const strengths = report.substance.find((x) => x.dimension === "strengths");
    expect(strengths?.people).toBe(3);
    for (const metric of ["none", "generic", "specific", "people"] as const) {
      expect(rows).toContainEqual({
        section: "substance",
        group: "strengths",
        metric,
        value: String(strengths?.[metric]),
      });
    }
    expect(rows.filter((r) => r.section === "agreement").length).toBe(
      report.agreement.rows.length * 2,
    );
    expect(
      rows.some((r) => ["sentiment", "sentiment_gap"].includes(r.section)),
    ).toBe(false);
    // Themes in people, per question and side (#129), like the screen.
    const themes = rows.filter((r) => r.section === "theme");
    expect(themes.length).toBeGreaterThan(0);
    expect(
      themes.every(
        (r) =>
          /^(strengths|improvement):/.test(String(r.group)) &&
          ["self", "manager"].includes(String(r.metric)),
      ),
    ).toBe(true);
  });
});
