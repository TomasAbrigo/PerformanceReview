import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { reviewCycle } from "@/db/schema";
import {
  as,
  direction,
  hr,
  insertIndicatorCycle,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { buildReportScenario } from "@/modules/insights/test-support";
import { groupKeyer } from "@/modules/org-attributes/group-key";
import type { GroupKeyer } from "@/modules/org-attributes/kinds";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import { ReviewError } from "@/modules/review-core/review-errors";
import { dm360 } from ".";

/**
 * The indicators scenario with its comments (see insights/test-support), and
 * two DMs who are the two managers: Marta Quiroga for Ana, Bruno, Carla,
 * Dario and Elena, Nora Salas for Fabio, Gina and Hugo; Iris has none. In C2
 * (9 participants) Marta is the snapshot manager of Ana..Fabio and Nora of
 * Gina, Hugo and Iris.
 */
let s: Scenario;
let cycleId: string;
let keyOf: GroupKeyer;

beforeAll(async () => {
  s = await buildReportScenario();
  cycleId = s.c2.cycleId;
  keyOf = await groupKeyer(db);
  for (const who of ["ana", "bruno", "carla", "dario", "elena"] as const) {
    await setOrgAttributes(
      s.id[who],
      { dm: "Marta Quiroga" },
      { refs: { dm: s.id.marta } },
    );
  }
  for (const who of ["fabio", "gina", "hugo"] as const) {
    await setOrgAttributes(
      s.id[who],
      { dm: "Nora Salas" },
      { refs: { dm: s.id.nora } },
    );
  }
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

const marta = () => as(s.id.marta, "manager");
const nora = () => as(s.id.nora, "manager");

describe("dm360 as People", () => {
  it("one card per DM with the people, means, risk, sentiment and completion of the cycle", async () => {
    const r = await dm360(db, hr, { cycleId });

    expect(r).toMatchObject({
      cycleId,
      cycleName: "H2 2024",
      scope: "direct",
      minGroupSize: null,
      withoutDm: 1,
      suppressed: 0,
    });
    expect(r.cards.map((c) => [c.key, c.label, c.people])).toEqual([
      ["Marta Quiroga", "Marta Quiroga", 5],
      ["Nora Salas", "Nora Salas", 3],
    ]);
    const [m, n] = r.cards;
    // Ana 2, Bruno 2, Carla 5, Dario 3, Elena 4 / engagement 4, 2, 5, 3, 2.
    expect(m.retention).toEqual({ mean: 3.2, n: 5 });
    expect(m.engagement).toEqual({ mean: 3.2, n: 5 });
    // Only Bruno has both at or under 2.
    expect(m.risk).toEqual({ people: 1, of: 5, share: 0.2 });
    // Ana 2 comments, Bruno 2, Carla 1: three positive... and one constructive, one negative.
    // Signals (#129): over the 3 people with read comments.
    expect(m.signals).toMatchObject({ of: 3 });
    // Self: Ana, Bruno, Carla submitted, Dario a draft, Elena none; manager: all.
    expect(m.selfRate).toBe(0.75);
    expect(m.managerRate).toBe(1);
    // Fabio 1,1; Gina 2,2; Hugo 4,4.
    expect(n.retention?.mean).toBeCloseTo(7 / 3);
    expect(n.risk).toEqual({ people: 2, of: 3, share: 2 / 3 });
    expect(n.signals).toBeNull();
    expect(n.insights).toEqual([
      { code: "riskHigh", params: { percent: 67, people: 2 } },
    ]);
  });

  it("evolves over the cycles: H1 then H2, and what each had", async () => {
    const r = await dm360(db, hr, { cycleId });

    const [m, n] = r.cards;
    // H1: Ana 4, Bruno 3, Carla 5, Elena 4 (Dario was not there); Fabio 3, Gina 2.
    expect(m.trend.map((p) => [p.cycleName, p.people, p.retention])).toEqual([
      ["H1 2024", 4, 4],
      ["H2 2024", 5, 3.2],
    ]);
    expect(n.trend.map((p) => [p.people, p.retention])).toEqual([
      [2, 2.5],
      [3, 7 / 3],
    ]);
    const first = await dm360(db, hr, { cycleId: s.c1.cycleId });
    expect(first.cards.map((c) => c.people)).toEqual([4, 2]);
    expect(first.cards[0].trend).toHaveLength(1);
  });

  it("takes its thresholds from the settings: a lower risk threshold finds fewer people at risk", async () => {
    const r = await dm360(db, hr, { cycleId, config: { riskThreshold: 1 } });

    expect(r.thresholds).toEqual({ dropThreshold: 2, riskThreshold: 1 });
    // Only Fabio (1,1) is at or under 1.
    expect(r.cards[1].risk).toEqual({ people: 1, of: 3, share: 1 / 3 });
    expect(r.cards[1].insights).toEqual([
      { code: "riskHigh", params: { percent: 33, people: 1 } },
    ]);
    expect(r.cards[0].risk?.people).toBe(0);
  });

  it("tree: adds everybody below the DM in the chart of the snapshot", async () => {
    const r = await dm360(db, hr, { cycleId, scope: "tree" });

    // Each participant is read on their own snapshot date (here 2025-06-01,
    // the date their DM attribute is read on too): Marta manages Bruno..Fabio
    // by then, Nora Gina, Hugo, Iris and, since 2025-01-01, Ana. The file
    // gives Marta Ana..Elena and Nora Fabio, Gina and Hugo.
    expect(r.scope).toBe("tree");
    expect(r.cards.map((c) => [c.key, c.people])).toEqual([
      ["Marta Quiroga", 6],
      ["Nora Salas", 5],
    ]);
    // Ana is Marta's by the file and Nora's by the chart: in both cards.
  });

  it("reads only the cycle asked for and the latest few before it, whatever the history holds", async () => {
    const old = [];
    for (let year = 2010; year < 2019; year++) {
      old.push(
        await insertIndicatorCycle({
          name: `Old ${year}`,
          periodStart: `${year}-01-01`,
          periodEnd: `${year}-12-31`,
        }),
      );
    }
    try {
      const r = await dm360(db, hr, { cycleId });

      // Eight points, the most recent: six of the nine old cycles, H1 and H2.
      expect(r.cards[0].trend.map((p) => p.cycleName)).toEqual([
        "Old 2013",
        "Old 2014",
        "Old 2015",
        "Old 2016",
        "Old 2017",
        "Old 2018",
        "H1 2024",
        "H2 2024",
      ]);
      // An old cycle is a cycle like any other: it can be read on its own.
      expect((await dm360(db, hr, { cycleId: old[0].cycleId })).cards).toEqual(
        [],
      );
    } finally {
      await db.delete(reviewCycle).where(like(reviewCycle.name, "Old %"));
    }
  });

  it("is forbidden to employees and a cycle that does not exist is not found", async () => {
    await expect(
      dm360(db, { personId: s.id.ana, role: "employee" }, { cycleId }),
    ).rejects.toBeInstanceOf(ReviewError);
    await expect(
      dm360(db, hr, { cycleId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(dm360(db, hr, { cycleId: "x" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("dm360 as a manager", () => {
  it("reads only their own card, when they are a DM, over their direct reports", async () => {
    const m = await dm360(db, marta(), { cycleId });

    expect(m.cards.map((c) => [c.key, c.people])).toEqual([
      ["Marta Quiroga", 5],
    ]);
    // Nora's direct reports are Gina, Hugo and Iris: her card holds Gina and
    // Hugo, not Fabio (he reports to Marta).
    const n = await dm360(db, nora(), { cycleId });
    expect(n.cards.map((c) => [c.key, c.people])).toEqual([["Nora Salas", 2]]);
    expect(n.cards[0].retention).toEqual({ mean: 3, n: 2 });
  });

  it("reads nothing when they are nobody's DM, and always the direct scope", async () => {
    const ana = as(s.id.ana, "manager");
    expect((await dm360(db, ana, { cycleId })).cards).toEqual([]);
    expect((await dm360(db, marta(), { cycleId, scope: "tree" })).scope).toBe(
      "direct",
    );
  });

  it("a manager without a person is forbidden", async () => {
    await expect(
      dm360(db, { personId: null, role: "manager" }, { cycleId }),
    ).rejects.toBeInstanceOf(ReviewError);
  });
});

describe("dm360 as direction", () => {
  it("reads aggregates: teams without the DM's name, DMs under the minimum folded", async () => {
    const r = await dm360(db, direction, {
      cycleId,
      config: { minGroupSize: 5 },
    });

    expect(r.minGroupSize).toBe(5);
    expect(r.withoutDm).toBeNull();
    expect(r.cards.map((c) => [c.key, c.label, c.others, c.people])).toEqual([
      [keyOf("Marta Quiroga"), null, false, 5],
    ]);
    // Nora's 3 are under the minimum, even alone as Otros: only counted.
    expect(r.suppressed).toBe(3);
    expect(JSON.stringify(r)).not.toMatch(/Marta|Nora/);
  });

  it("shows Otros when the small DMs together reach the minimum, and each figure needs its own people", async () => {
    const r = await dm360(db, direction, {
      cycleId,
      config: { minGroupSize: 3 },
    });

    expect(r.cards.map((c) => [c.label, c.others, c.people])).toEqual([
      [null, false, 5],
      [null, false, 3],
    ]);
    // 3 people wrote comments in Marta's card, nobody in Nora's.
    expect(r.cards[0].signals).toMatchObject({ of: 3 });
    expect(r.cards[1].signals).toBeNull();
    const four = await dm360(db, direction, {
      cycleId,
      config: { minGroupSize: 4 },
    });
    // Marta's 5 are in; of them 4 reach the retention and the signals (3 people with comments) are hidden.
    expect(four.cards[0].retention?.n).toBe(5);
    expect(four.cards[0].signals).toBeNull();
    expect(four.cards[0].selfRate).toBe(0.75);
  });

  it("the trend hides the cycles with fewer people than the minimum", async () => {
    const r = await dm360(db, direction, {
      cycleId,
      config: { minGroupSize: 5 },
    });

    // H1 had four people under Marta: hidden. H2 has five.
    expect(
      r.cards[0].trend.map((p) => [p.cycleName, p.people, p.retention]),
    ).toEqual([
      ["H1 2024", null, null],
      ["H2 2024", 5, 3.2],
    ]);
  });
});
