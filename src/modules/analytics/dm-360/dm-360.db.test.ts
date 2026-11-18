import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  as,
  direction,
  hr,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { buildReportScenario } from "@/modules/insights/test-support";
import { opaqueKey } from "@/modules/org-attributes/kinds";
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

beforeAll(async () => {
  s = await buildReportScenario();
  cycleId = s.c2.cycleId;
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
    expect(m.sentiment).toMatchObject({
      comments: 5,
      people: 3,
      counts: { positive: 3, constructive: 1, negative: 1 },
    });
    // Self: Ana, Bruno, Carla submitted, Dario a draft, Elena none; manager: all.
    expect(m.selfRate).toBe(0.75);
    expect(m.managerRate).toBe(1);
    // Fabio 1,1; Gina 2,2; Hugo 4,4.
    expect(n.retention?.mean).toBeCloseTo(7 / 3);
    expect(n.risk).toEqual({ people: 2, of: 3, share: 2 / 3 });
    expect(n.sentiment).toBeNull();
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

    // Marta manages Ana..Fabio (Fabio is Nora's by the file); Nora manages
    // Gina, Hugo and Iris (and the file gives her Fabio).
    expect(r.scope).toBe("tree");
    expect(r.cards.map((c) => [c.key, c.people])).toEqual([
      ["Marta Quiroga", 6],
      ["Nora Salas", 4],
    ]);
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
      [opaqueKey("Marta Quiroga"), null, false, 5],
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
    expect(r.cards[0].sentiment).not.toBeNull();
    expect(r.cards[1].sentiment).toBeNull();
    const four = await dm360(db, direction, {
      cycleId,
      config: { minGroupSize: 4 },
    });
    // Marta's 5 are in; of them 4 reach the retention and sentiment (3 writers) is hidden.
    expect(four.cards[0].retention?.n).toBe(5);
    expect(four.cards[0].sentiment).toBeNull();
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
