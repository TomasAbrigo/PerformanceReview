import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  insertParticipant,
  insertPerson,
} from "@/modules/analytics/test-support";
import { setSetting } from "@/modules/settings";
import { goalsVsIndicators } from ".";
import {
  as,
  buildScenario,
  direction,
  hr,
  insertGoals,
  insertLabeledComments,
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

/**
 * More people of Marta's team in H1 with one goal in progress, none
 * completed (the 0-20 % bucket): `withReview` of them with the manager's
 * retention and engagement (3 and 3), `without` of them with no review.
 */
async function addPeopleWithGoalsInProgress(
  scenario: Scenario,
  n: { withReview: number; without: number },
) {
  for (let i = 0; i < n.withReview + n.without; i++) {
    const personId = await insertPerson({
      displayName: `Extra ${i + 1}`,
      noEmployment: true,
    });
    const participantId = await insertParticipant({
      cycleId: scenario.h1.cycleId,
      personId,
      snapManagerPersonId: scenario.id.marta,
      snapDepartment: "Ingeniería",
    });
    await insertGoals(participantId, [
      { status: "in_progress", percent: 10, due: "2025-12-31" },
    ]);
    if (i < n.withReview) {
      await insertReview({
        cycle: scenario.h1,
        participantId,
        reviewerPersonId: scenario.id.marta,
        retention: 3,
        engagement: 3,
      });
    }
  }
}

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
      retentionPeople: 3,
      engagementPeople: 3,
      meanRetention: 4,
      meanEngagement: 4,
      meanPositiveShare: 0.75,
    });
    // Iris answered only retention: the n of each mean is its own.
    expect(buckets[2]).toMatchObject({
      people: 1,
      retentionPeople: 1,
      engagementPeople: 0,
      meanRetention: 5,
      meanEngagement: null,
      meanPositiveShare: null,
    });
    // Retention (2 + 5 + 3 + 4) / 4, engagement (4 + 5 + 1 + 4) / 4; only Ana
    // has labels: 0.5.
    expect(buckets[4]).toMatchObject({
      retentionPeople: 4,
      engagementPeople: 4,
      meanRetention: 3.5,
      meanEngagement: 3.5,
      meanPositiveShare: 0.5,
    });
  });

  it("n counts the people who have the indicator, not everybody with goals in the bucket", async () => {
    const fresh = await buildScenario();
    try {
      await addPeopleWithGoalsInProgress(fresh, { withReview: 2, without: 2 });
      const { buckets } = await goalsVsIndicators(db, hr, {
        cycleId: fresh.h1.cycleId,
      });
      // Four people with goals in the 0-20 % bucket, two of them with the
      // manager's answers (3 and 3): the means are of those two.
      expect(buckets[0]).toMatchObject({
        people: 4,
        retentionPeople: 2,
        engagementPeople: 2,
        meanRetention: 3,
        meanEngagement: 3,
      });
    } finally {
      s = await buildScenario();
    }
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

describe("goalsVsIndicators (direction: the minimum is measured on the people who have the indicator)", () => {
  it("hides the mean of an indicator whose own base is under the minimum, even when the bucket has enough people with goals", async () => {
    const fresh = await buildScenario();
    try {
      await setSetting(db, hr, "aggregation.minGroupSize", 3);
      // 4 people with goals at 0-20 %, but only 2 have retention and
      // engagement: the bars would average 2 people.
      await addPeopleWithGoalsInProgress(fresh, { withReview: 2, without: 2 });
      const { buckets, suppressed } = await goalsVsIndicators(db, direction, {
        cycleId: fresh.h1.cycleId,
      });
      expect(buckets[0]).toMatchObject({
        people: 4,
        hidden: false,
        retentionPeople: null,
        engagementPeople: null,
        meanRetention: null,
        meanEngagement: null,
      });
      // The buckets that do have 3 or more with the indicator stay.
      expect(buckets[1]).toMatchObject({
        retentionPeople: 3,
        engagementPeople: 3,
        meanRetention: 4,
        meanEngagement: 4,
      });
      // Iris alone (40-60 %) is the one bucket under the minimum.
      expect(suppressed).toBe(1);
    } finally {
      s = await buildScenario();
    }
  });

  it("a bucket nobody answered shows no mean, and the n is zero", async () => {
    const fresh = await buildScenario();
    try {
      await setSetting(db, hr, "aggregation.minGroupSize", 3);
      await addPeopleWithGoalsInProgress(fresh, { withReview: 0, without: 3 });
      const { buckets } = await goalsVsIndicators(db, direction, {
        cycleId: fresh.h1.cycleId,
      });
      expect(buckets[0]).toMatchObject({
        people: 3,
        hidden: false,
        retentionPeople: 0,
        engagementPeople: 0,
        meanRetention: null,
        meanEngagement: null,
      });
    } finally {
      s = await buildScenario();
    }
  });
});

describe("goalsVsIndicators (sentiment)", () => {
  it("counts the comments of the self and manager reviews only, not a peer's or upward feedback", async () => {
    const fresh = await buildScenario();
    try {
      for (const relationship of ["peer", "upward"] as const) {
        const request = await insertReview({
          cycle: fresh.h1,
          participantId: fresh.participant.ana,
          reviewerPersonId: fresh.id.bruno,
          relationship,
        });
        await insertLabeledComments(fresh.h1, request, [
          "negative",
          "negative",
          "negative",
        ]);
      }
      const { rows } = await goalsVsIndicators(db, hr, {
        cycleId: fresh.h1.cycleId,
      });
      // Still Ana's 4 comments (2 positive): the 6 negative ones are not hers.
      expect(rowOf(rows, "Ana Prieto")).toMatchObject({
        positiveShare: 0.5,
        labeledComments: 4,
      });
    } finally {
      s = await buildScenario();
    }
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
