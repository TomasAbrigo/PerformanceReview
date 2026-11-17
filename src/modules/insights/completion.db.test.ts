import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { assessmentProgress } from "@/db/schema";
import {
  as,
  buildScenario,
  direction,
  hr,
  insertIndicatorReview,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { insightsScope } from "./authz";
import { completion } from "./completion";

let s: Scenario;

beforeAll(async () => {
  s = await buildScenario();
  // C2: self reviews of Ana, Bruno and Carla submitted, Dario's a draft.
  for (const who of ["ana", "bruno", "carla", "dario"] as const) {
    await insertIndicatorReview({
      cycle: s.c2,
      participantId: s.participant(s.c2, who),
      reviewerPersonId: s.id[who],
      relationship: "self",
      status: who === "dario" ? "draft" : "submitted",
    });
  }
  // C1: Bamboo's Assessment Progress report says how Ana and Bruno stand.
  const row = (
    who: "ana" | "bruno",
    selfStatus: "submitted" | "not_applicable",
    managerStatus: "submitted" | "in_progress",
  ) => ({
    cycleId: s.c1.cycleId,
    participantId: s.participant(s.c1, who),
    selfStatus,
    managerStatus,
    assessed: managerStatus === "submitted",
    sourceSystem: "bamboo_export" as const,
    sourceId: who,
    payloadHash: who,
  });
  await db
    .insert(assessmentProgress)
    .values([
      row("ana", "submitted", "submitted"),
      row("bruno", "not_applicable", "in_progress"),
    ]);
}, 30_000);

afterAll(async () => {
  await reset();
  await closeDb();
});

describe("completion (fallback over assessment_progress + review_request)", () => {
  it("People: per department, from the review requests", async () => {
    const c = await completion(db, insightsScope(hr), {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    expect(c.groups).toEqual([
      {
        key: "Ingeniería",
        label: "Ingeniería",
        n: 6,
        self: { submitted: 3, total: 6 },
        manager: { submitted: 6, total: 6 },
      },
      {
        key: "Producto",
        label: "Producto",
        n: 3,
        self: { submitted: 0, total: 3 },
        manager: { submitted: 3, total: 3 },
      },
    ]);
    expect(c.total).toEqual({
      key: null,
      label: null,
      n: 9,
      self: { submitted: 3, total: 9 },
      manager: { submitted: 9, total: 9 },
    });
    expect(c.minGroupSize).toBeNull();
  });

  it("assessment_progress wins where Bamboo's report has the participant", async () => {
    const c = await completion(db, insightsScope(hr), {
      cycleId: s.c1.cycleId,
      groupBy: "department",
    });
    expect(c.groups.map((g) => [g.key, g.self, g.manager])).toEqual([
      ["Ingeniería", { submitted: 1, total: 4 }, { submitted: 4, total: 5 }],
      ["Producto", { submitted: 0, total: 1 }, { submitted: 1, total: 1 }],
    ]);
  });

  it("per manager, named", async () => {
    const c = await completion(db, insightsScope(hr), {
      cycleId: s.c2.cycleId,
      groupBy: "manager",
    });
    expect(c.groups.map((g) => [g.key, g.label, g.n])).toEqual([
      [s.id.marta, "Marta Quiroga", 6],
      [s.id.nora, "Nora Salas", 3],
    ]);
  });

  it("a manager: only the direct reports of the snapshot", async () => {
    const c = await completion(db, insightsScope(as(s.id.nora, "manager")), {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    expect(c.groups.map((g) => [g.key, g.n])).toEqual([["Producto", 3]]);
    expect(c.total?.n).toBe(3);
  });

  it("direction: groups under the minimum are folded or suppressed", async () => {
    const c = await completion(db, insightsScope(direction, 5), {
      cycleId: s.c2.cycleId,
      groupBy: "department",
    });
    expect(c.groups.map((g) => g.key)).toEqual(["Ingeniería"]);
    expect(c.others).toBeNull();
    expect(c.suppressed).toBe(3);
    expect(c.minGroupSize).toBe(5);
    expect(c.total?.n).toBe(9);

    const all = await completion(db, insightsScope(direction, 10), {
      cycleId: s.c2.cycleId,
      groupBy: "none",
    });
    expect(all.total).toBeNull();
    expect(all.groups).toEqual([]);
  });

  it("an employee: nothing", async () => {
    await expect(
      completion(db, insightsScope(as(s.id.ana, "employee")), {
        cycleId: s.c2.cycleId,
        groupBy: "department",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
