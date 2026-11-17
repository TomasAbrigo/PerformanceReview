import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { setSetting } from "@/modules/settings";
import { goalsVsIndicators } from ".";
import {
  as,
  buildScenario,
  direction,
  hr,
  insertReview,
  reset,
  type Scenario,
} from "./test-support";

let s: Scenario;

beforeAll(async () => {
  s = await buildScenario();
});
afterEach(async () => {
  await db.execute(sql`delete from app_setting`);
});
afterAll(async () => {
  await reset();
  await closeDb();
});

const rowOf = (rows: { name: string }[], name: string): (typeof rows)[number] =>
  rows.find((r) => r.name === name)!;

describe("goalsVsIndicators (People)", () => {
  it("one row per participant with goals, indicators and sentiment, by hand", async () => {
    const { rows, withoutGoals } = await goalsVsIndicators(db, hr, {
      cycleId: s.h1.cycleId,
    });
    expect(rows.map((r) => r.name)).toEqual([
      "Ana Prieto",
      "Bruno Soler",
      "Carla Vega",
      "Dario Mena",
      "Elena Ríos",
      "Fabio Luna",
      "Gina Paz",
      "Hugo Sosa",
      "Iris Cano",
    ]);
    // Ana: 4 of 5 goals completed, mean progress 92; manager answered
    // retention 2 / engagement 4; 2 of her 4 labeled comments are positive.
    expect(rowOf(rows, "Ana Prieto")).toMatchObject({
      managerName: "Marta Quiroga",
      department: "Ingeniería",
      goals: 5,
      completed: 4,
      completedPct: 80,
      avgProgress: 92,
      retention: 2,
      engagement: 4,
      positiveShare: 0.5,
      labeledComments: 4,
    });
    // Bruno: both his machine labels were negative, a human corrected one:
    // the effective labels are positive and negative -> 1 of 2.
    expect(rowOf(rows, "Bruno Soler")).toMatchObject({
      completedPct: 25,
      avgProgress: 45,
      retention: 3,
      engagement: 3,
      positiveShare: 0.5,
      labeledComments: 2,
    });
    // No labeled comments: no share (not zero).
    expect(rowOf(rows, "Carla Vega")).toMatchObject({
      completedPct: 100,
      retention: 5,
      engagement: 5,
      positiveShare: null,
      labeledComments: 0,
    });
    // No goals: no completion, but still the indicators.
    expect(rowOf(rows, "Dario Mena")).toMatchObject({
      goals: 0,
      completedPct: null,
      avgProgress: null,
      retention: 3,
      engagement: 3,
    });
    expect(rowOf(rows, "Elena Ríos")).toMatchObject({
      completedPct: 30,
      avgProgress: 65,
      retention: 4,
      engagement: 5,
    });
    expect(rowOf(rows, "Fabio Luna")).toMatchObject({
      completedPct: 80,
      avgProgress: 86,
      retention: 3,
      engagement: 1,
    });
    expect(rowOf(rows, "Gina Paz")).toMatchObject({
      completedPct: 25,
      avgProgress: 32.5,
      retention: 5,
      engagement: 4,
      positiveShare: 1,
      labeledComments: 3,
    });
    // An unanswered indicator is null.
    expect(rowOf(rows, "Iris Cano")).toMatchObject({
      completedPct: 50,
      retention: 5,
      engagement: null,
    });
    expect(withoutGoals).toBe(1);
  });

  it("aggregates the indicator means per completion bucket", async () => {
    const { buckets, suppressed, minGroupSize } = await goalsVsIndicators(
      db,
      hr,
      { cycleId: s.h1.cycleId },
    );
    expect(minGroupSize).toBeNull();
    expect(suppressed).toBe(0);
    expect(buckets.map((b) => [b.from, b.to, b.people])).toEqual([
      [0, 20, 0],
      [20, 40, 3], // Bruno 25 %, Elena 30 %, Gina 25 %
      [40, 60, 1], // Iris 50 %
      [60, 80, 0],
      [80, 100, 4], // Ana 80 %, Carla 100 %, Fabio 80 %, Hugo 100 %
    ]);
    expect(buckets[0]).toMatchObject({
      meanRetention: null,
      meanEngagement: null,
      meanPositiveShare: null,
      hidden: false,
    });
    // Retention (3 + 4 + 5) / 3, engagement (3 + 5 + 4) / 3; sentiment: Bruno
    // 0.5 and Gina 1 (Elena has no labels): 0.75.
    expect(buckets[1]).toMatchObject({
      meanRetention: 4,
      meanEngagement: 4,
      meanPositiveShare: 0.75,
    });
    // Iris answered only retention.
    expect(buckets[2]).toMatchObject({
      meanRetention: 5,
      meanEngagement: null,
      meanPositiveShare: null,
    });
    // Retention (2 + 5 + 3 + 4) / 4, engagement (4 + 5 + 1 + 4) / 4; only Ana
    // has labels: 0.5.
    expect(buckets[4]).toMatchObject({
      meanRetention: 3.5,
      meanEngagement: 3.5,
      meanPositiveShare: 0.5,
    });
  });

  it("reads today's org with the current hierarchy", async () => {
    const { rows } = await goalsVsIndicators(db, hr, {
      cycleId: s.h1.cycleId,
      hierarchy: "current",
    });
    expect(rowOf(rows, "Ana Prieto")).toMatchObject({
      managerName: "Nora Salas",
      department: "Producto",
    });
  });

  it("filters by area", async () => {
    const { rows, buckets } = await goalsVsIndicators(db, hr, {
      cycleId: s.h1.cycleId,
      filters: { department: "Producto" },
    });
    expect(rows.map((r) => r.name)).toEqual([
      "Gina Paz",
      "Hugo Sosa",
      "Iris Cano",
    ]);
    expect(buckets.map((b) => b.people)).toEqual([0, 1, 1, 0, 1]);
  });

  it("is not_found for an unknown cycle", async () => {
    await expect(
      goalsVsIndicators(db, hr, {
        cycleId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("goalsVsIndicators (who reads)", () => {
  it("a manager reads their direct reports only", async () => {
    const { rows, buckets, withoutGoals } = await goalsVsIndicators(
      db,
      as(s.id.marta, "manager"),
      { cycleId: s.h1.cycleId },
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Ana Prieto",
      "Bruno Soler",
      "Carla Vega",
      "Dario Mena",
      "Elena Ríos",
      "Fabio Luna",
    ]);
    expect(withoutGoals).toBe(1);
    // Bruno and Elena: retention (3 + 4) / 2, engagement (3 + 5) / 2, and
    // only Bruno has labels (0.5).
    expect(buckets[1]).toMatchObject({
      people: 2,
      meanRetention: 3.5,
      meanEngagement: 4,
      meanPositiveShare: 0.5,
    });
    // Ana, Carla, Fabio: (2 + 5 + 3) / 3 and (4 + 5 + 1) / 3.
    expect(buckets[4].people).toBe(3);
    expect(buckets[4].meanRetention).toBeCloseTo(10 / 3);
    expect(buckets[4].meanEngagement).toBeCloseTo(10 / 3);
    // Nora's people are not Marta's.
    expect(rows.map((r) => r.name)).not.toContain("Gina Paz");
  });

  it("an employee is forbidden, also reading about themself", async () => {
    for (const actor of [
      as(s.id.ana, "employee"),
      { personId: null, role: "employee" as const },
      { personId: null, role: "manager" as const },
    ]) {
      await expect(
        goalsVsIndicators(db, actor, { cycleId: s.h1.cycleId }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("direction gets no person and hides every bucket under the minimum", async () => {
    // Minimum 5 (the default): no bucket has that many people.
    const strict = await goalsVsIndicators(db, direction, {
      cycleId: s.h1.cycleId,
    });
    expect(strict.rows).toEqual([]);
    expect(strict.minGroupSize).toBe(5);
    expect(strict.withoutGoals).toBeNull();
    expect(strict.buckets.map((b) => [b.people, b.hidden])).toEqual([
      [0, false],
      [null, true],
      [null, true],
      [0, false],
      [null, true],
    ]);
    expect(strict.buckets.every((b) => b.meanRetention === null)).toBe(true);
    // 3 + 1 + 4 people are left out.
    expect(strict.suppressed).toBe(8);
  });

  it("direction sees the buckets over the minimum, with the rest hidden and counted", async () => {
    await setSetting(db, hr, "aggregation.minGroupSize", 3);
    const { rows, buckets, suppressed } = await goalsVsIndicators(
      db,
      direction,
      {
        cycleId: s.h1.cycleId,
      },
    );
    expect(rows).toEqual([]);
    expect(buckets.map((b) => [b.people, b.hidden])).toEqual([
      [0, false], // nobody: nothing to hide
      [3, false],
      [null, true], // Iris alone: under 3
      [0, false],
      [4, false],
    ]);
    expect(buckets[1]).toMatchObject({ meanRetention: 4, meanEngagement: 4 });
    expect(buckets[2]).toMatchObject({
      meanRetention: null,
      meanEngagement: null,
      meanPositiveShare: null,
    });
    expect(suppressed).toBe(1);
  });
});

describe("goalsVsIndicators (indicator answers)", () => {
  it("counts the latest submitted manager review; drafts and deleted ones never", async () => {
    const fresh = await buildScenario();
    try {
      const hugo = fresh.participant.hugo;
      // A draft and a deleted review say 1/1: ignored.
      await insertReview({
        cycle: fresh.h1,
        participantId: hugo,
        reviewerPersonId: fresh.id.marta,
        retention: 1,
        engagement: 1,
        status: "draft",
      });
      await insertReview({
        cycle: fresh.h1,
        participantId: hugo,
        reviewerPersonId: fresh.id.ana,
        retention: 1,
        engagement: 1,
        deleted: true,
      });
      const before = await goalsVsIndicators(db, hr, {
        cycleId: fresh.h1.cycleId,
      });
      expect(rowOf(before.rows, "Hugo Sosa")).toMatchObject({
        retention: 4,
        engagement: 4,
      });
      // A later submitted review by another reviewer replaces the first.
      await insertReview({
        cycle: fresh.h1,
        participantId: hugo,
        reviewerPersonId: fresh.id.carla,
        retention: 2,
        engagement: 3,
        submittedAt: new Date(Date.now() + 60_000),
      });
      // And a self review never gives indicators.
      await insertReview({
        cycle: fresh.h1,
        participantId: hugo,
        reviewerPersonId: fresh.id.hugo,
        retention: 5,
        engagement: 5,
        relationship: "self",
        submittedAt: new Date(Date.now() + 120_000),
      });
      const after = await goalsVsIndicators(db, hr, {
        cycleId: fresh.h1.cycleId,
      });
      expect(rowOf(after.rows, "Hugo Sosa")).toMatchObject({
        retention: 2,
        engagement: 3,
      });
    } finally {
      s = await buildScenario();
    }
  });
});
