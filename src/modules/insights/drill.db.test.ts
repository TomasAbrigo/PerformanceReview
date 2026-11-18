import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  as,
  direction,
  hr,
  names,
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { drillRecords } from "./drill";
import type { Drill } from "./drill-spec";
import { buildReportScenario } from "./test-support";

let s: Scenario;
beforeAll(async () => {
  s = await buildReportScenario();
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

const drillAs = (actor: Parameters<typeof drillRecords>[1], drill: Drill) =>
  drillRecords(db, actor, { cycleId: s.c2.cycleId, drill, minGroupSize: 5 });
const namesOf = (r: Awaited<ReturnType<typeof drillRecords>>) =>
  r.people?.map((p) => p.name);

describe("drillRecords", () => {
  it("People: who got a value of an indicator, with their figures and link", async () => {
    // Retention 2 in C2: Ana, Bruno, Gina.
    const r = await drillAs(hr, {
      kind: "indicator",
      indicator: "retention",
      value: 2,
    });
    expect(r.total).toBe(3);
    expect(namesOf(r)).toEqual([names.ana, names.bruno, names.gina]);
    expect(r.people?.[0]).toMatchObject({
      facts: [
        { key: "retention", value: 2 },
        { key: "engagement", value: 4 },
      ],
      href: `/insights/indicators/trend?person=${s.id.ana}`,
    });
    expect(r.breakdown).toEqual([
      { key: "Ingeniería", others: false, n: 2 },
      { key: "Producto", others: false, n: 1 },
    ]);
  });

  it("People: the people of a risk-matrix cell", async () => {
    const r = await drillAs(hr, {
      kind: "risk",
      retention: "low",
      engagement: "low",
    });
    expect(namesOf(r)).toEqual([names.bruno, names.fabio, names.gina]);
  });

  it("a manager: only their direct reports of the snapshot", async () => {
    const r = await drillAs(as(s.id.nora, "manager"), {
      kind: "risk",
      retention: "low",
      engagement: "low",
    });
    expect(namesOf(r)).toEqual([names.gina]);
    expect(r.minGroupSize).toBeNull();
  });

  it("direction: no names, and nothing under the minimum", async () => {
    const small = await drillAs(direction, {
      kind: "risk",
      retention: "low",
      engagement: "low",
    });
    expect(small.people).toBeNull();
    expect(small.total).toBeNull();
    expect(small.breakdown).toEqual([]);
    // The manager side, submitted by all 9.
    const big = await drillAs(direction, {
      kind: "completion",
      side: "manager",
      state: "submitted",
    });
    expect(big.people).toBeNull();
    // Ingeniería 6, Producto 3 (under 5): the 3 cannot be folded alone, so
    // it is hidden, and so is the total (9 - 6 would give it away).
    expect(big.total).toBeNull();
    expect(big.breakdown).toEqual([{ key: "Ingeniería", others: false, n: 6 }]);
    expect(JSON.stringify(big)).not.toContain(names.ana);
  });

  it("People: completion by side and state", async () => {
    // Self: Ana, Bruno, Carla submitted; Dario's is a draft.
    const pending = await drillAs(hr, {
      kind: "completion",
      side: "self",
      state: "pending",
    });
    expect(namesOf(pending)).toEqual([names.dario]);
    expect(pending.people?.[0].href).toMatch(
      new RegExp(`^/assessments/${s.c2.cycleId}/[0-9a-f-]{36}$`),
    );
  });

  it("People: the comments of a theme; direction only counts", async () => {
    const r = await drillAs(hr, { kind: "theme", theme: "calidad" });
    expect(r.unit).toBe("comments");
    expect(r.total).toBe(2);
    expect(r.comments?.map((c) => c.personName).sort()).toEqual([
      names.ana,
      names.bruno,
    ]);
    expect(r.moreHref).toContain("theme=calidad");
    const masked = await drillAs(direction, {
      kind: "theme",
      theme: "calidad",
    });
    expect(masked.comments).toBeNull();
    // Two people's comments: under the minimum, hidden.
    expect(masked.total).toBeNull();
  });

  it("People: the comments of a dimension with a sentiment", async () => {
    const r = await drillAs(hr, {
      kind: "sentiment",
      dimension: "strengths",
      sentiment: "negative",
    });
    expect(r.comments?.map((c) => c.text)).toEqual([
      "Llego tarde, es un problema.",
    ]);
  });

  it("People: goals (none in the scenario's period)", async () => {
    const r = await drillAs(hr, { kind: "goals", state: "all" });
    expect(r.total).toBe(0);
    expect(r.people).toEqual([]);
  });

  it("an employee is forbidden", async () => {
    await expect(
      drillAs(as(s.id.ana, "employee"), { kind: "goals", state: "all" }),
    ).rejects.toThrow();
  });

  // ---- quant (#117): group- and month-scoped drills ----
  it("People: an indicator answer within one area", async () => {
    // Retention 2 in C2: Ana and Bruno in Ingeniería, Gina in Producto.
    const r = await drillAs(hr, {
      kind: "indicatorGroup",
      indicator: "retention",
      value: 2,
      groupBy: "department",
      key: "Ingeniería",
    });
    expect(namesOf(r)).toEqual([names.ana, names.bruno]);
    const team = await drillAs(hr, {
      kind: "indicatorGroup",
      indicator: "retention",
      value: null,
      groupBy: "manager",
      key: s.id.nora,
    });
    expect(namesOf(team)).toContain(names.gina);
    expect(namesOf(team)).not.toContain(names.ana);
  });

  it("People: completion of one group; a manager stays in their reports", async () => {
    const r = await drillAs(hr, {
      kind: "completionGroup",
      side: "manager",
      state: "submitted",
      groupBy: "department",
      key: "Producto",
    });
    expect(r.total).toBe(3);
    expect(r.breakdown).toEqual([{ key: "Producto", others: false, n: 3 }]);
    const mine = await drillAs(as(s.id.nora, "manager"), {
      kind: "completionGroup",
      side: "manager",
      state: "submitted",
      groupBy: "department",
      key: "Ingeniería",
    });
    for (const p of mine.people ?? []) expect(p.managerName).toBe(names.nora);
  });

  it("direction: a group drill by area is masked; by a person, forbidden", async () => {
    const r = await drillAs(direction, {
      kind: "completionGroup",
      side: "manager",
      state: "submitted",
      groupBy: "department",
      key: "Ingeniería",
    });
    expect(r.people).toBeNull();
    expect(r.total).toBe(6);
    await expect(
      drillAs(direction, {
        kind: "indicatorGroup",
        indicator: "retention",
        value: null,
        groupBy: "manager",
        key: s.id.nora,
      }),
    ).rejects.toThrow();
  });

  it("engagement month: People get the people, direction never names", async () => {
    const drill: Drill = {
      kind: "engagement",
      month: "2026-01-01",
      segment: null,
    };
    const r = await drillAs(hr, drill);
    expect(r.people).toEqual([]);
    const masked = await drillAs(direction, drill);
    expect(masked.people).toBeNull();
    expect(masked.total).toBeNull();
  });
});
