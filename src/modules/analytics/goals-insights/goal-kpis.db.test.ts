import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { setSetting } from "@/modules/settings";
import { goalInsights, goalInsightsFilterOptions, goalKpis } from ".";
import {
  as,
  buildScenario,
  direction,
  hr,
  reset,
  type Scenario,
} from "./test-support";

let s: Scenario;

beforeAll(async () => {
  s = await buildScenario();
});
afterEach(async () => {
  // Tests that change the minimum group size leave nothing behind.
  await db.execute(sql`delete from app_setting`);
});
afterAll(async () => {
  await reset();
  await closeDb();
});

const h1 = () => s.h1.cycleId;
const byLabel = <G extends { label: string | null }>(
  groups: G[],
  label: string,
): G => groups.find((g) => g.label === label)!;

describe("goalKpis (People)", () => {
  it("per person: goals, shares and mean progress, worked out by hand", async () => {
    const { groups, total, minGroupSize } = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "person",
    });
    expect(minGroupSize).toBeNull();
    // Zoe was removed from the cycle: nowhere.
    expect(groups.map((g) => g.label)).toEqual([
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
    // Ana: 5 goals, 4 completed (80 %), 1 in progress (20 %), none overdue,
    // progress (4 * 100 + 60) / 5 = 92.
    expect(byLabel(groups, "Ana Prieto")).toMatchObject({
      people: 1,
      peopleWithGoals: 1,
      goals: 5,
      completed: 4,
      inProgress: 1,
      closed: 0,
      overdue: 0,
      completedPct: 80,
      inProgressPct: 20,
      overduePct: 0,
      avgProgress: 92,
    });
    // Bruno: 4 goals: 1 completed, 2 in progress (one overdue, the one due
    // on the last day of the period is not), 1 closed (never overdue).
    expect(byLabel(groups, "Bruno Soler")).toMatchObject({
      goals: 4,
      completed: 1,
      inProgress: 2,
      closed: 1,
      overdue: 1,
      completedPct: 25,
      inProgressPct: 50,
      overduePct: 25,
      avgProgress: 45,
    });
    // Carla's "ya no aplica" goal does not count.
    expect(byLabel(groups, "Carla Vega")).toMatchObject({
      goals: 2,
      completed: 2,
      completedPct: 100,
      avgProgress: 100,
    });
    // Dario has no goals: no shares, but he is a person of the cycle.
    expect(byLabel(groups, "Dario Mena")).toMatchObject({
      people: 1,
      peopleWithGoals: 0,
      goals: 0,
      completedPct: null,
      inProgressPct: null,
      overduePct: null,
      avgProgress: null,
    });
    // Gina: a goal without a due date is never overdue; 2 of 4 are.
    expect(byLabel(groups, "Gina Paz")).toMatchObject({
      goals: 4,
      completed: 1,
      inProgress: 3,
      overdue: 2,
      overduePct: 50,
      avgProgress: 32.5,
    });
    // Everybody: 33 goals, 17 completed, 15 in progress, 1 closed, 4 overdue,
    // progress 2290 / 33.
    expect(total).toMatchObject({
      people: 9,
      peopleWithGoals: 8,
      goals: 33,
      completed: 17,
      inProgress: 15,
      closed: 1,
      overdue: 4,
    });
    expect(total!.completedPct).toBeCloseTo((17 / 33) * 100);
    expect(total!.avgProgress).toBeCloseTo(2290 / 33);
  });

  it("per manager of the snapshot (the default hierarchy)", async () => {
    const { groups } = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "manager",
    });
    expect(groups.map((g) => g.label)).toEqual(["Marta Quiroga", "Nora Salas"]);
    // Marta's team: Ana, Bruno, Carla, Dario, Elena, Fabio.
    const marta = byLabel(groups, "Marta Quiroga");
    expect(marta).toMatchObject({
      people: 6,
      peopleWithGoals: 5,
      goals: 26,
      completed: 14,
      inProgress: 11,
      closed: 1,
      overdue: 2,
    });
    expect(marta.completedPct).toBeCloseTo((14 / 26) * 100);
    expect(marta.inProgressPct).toBeCloseTo((11 / 26) * 100);
    expect(marta.overduePct).toBeCloseTo((2 / 26) * 100);
    expect(marta.avgProgress).toBeCloseTo(1920 / 26);
    // Nora's: Gina, Hugo, Iris.
    const nora = byLabel(groups, "Nora Salas");
    expect(nora).toMatchObject({
      people: 3,
      goals: 7,
      completed: 3,
      inProgress: 4,
      overdue: 2,
    });
    expect(nora.completedPct).toBeCloseTo((3 / 7) * 100);
    expect(nora.avgProgress).toBeCloseTo(370 / 7);
  });

  it("per department, and with today's hierarchy Ana moves to Producto", async () => {
    const asOf = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "department",
    });
    expect(asOf.groups.map((g) => [g.label, g.people, g.goals])).toEqual([
      ["Ingeniería", 6, 26],
      ["Producto", 3, 7],
    ]);
    const current = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "department",
      hierarchy: "current",
    });
    // Ana (5 goals) now works in Producto.
    expect(current.hierarchy).toBe("current");
    expect(current.groups.map((g) => [g.label, g.people, g.goals])).toEqual([
      ["Ingeniería", 5, 21],
      ["Producto", 4, 12],
    ]);
    const byManager = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "manager",
      hierarchy: "current",
    });
    expect(byManager.groups.map((g) => [g.label, g.people])).toEqual([
      ["Marta Quiroga", 5],
      ["Nora Salas", 4],
    ]);
  });

  it("filters by area and manager", async () => {
    const dep = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "person",
      filters: { department: "Producto" },
    });
    expect(dep.groups.map((g) => g.label)).toEqual([
      "Gina Paz",
      "Hugo Sosa",
      "Iris Cano",
    ]);
    const mgr = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "department",
      filters: { managerId: s.id.nora },
    });
    expect(mgr.groups.map((g) => [g.label, g.people])).toEqual([
      ["Producto", 3],
    ]);
    expect(mgr.total).toMatchObject({ people: 3, goals: 7 });
  });

  it("ignores a filter id that is not a uuid, like the dashboards do", async () => {
    const all = await goalKpis(db, hr, { cycleId: h1(), groupBy: "person" });
    const ignored = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "person",
      filters: { managerId: "not-a-uuid" },
    });
    expect(ignored.groups.map((g) => g.label)).toEqual(
      all.groups.map((g) => g.label),
    );
    // A uuid nobody manages is a filter that matches nobody.
    const nobody = await goalKpis(db, hr, {
      cycleId: h1(),
      groupBy: "person",
      filters: { managerId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(nobody.groups).toEqual([]);
  });

  it("only counts the goals of the cycle that was asked for", async () => {
    const { groups } = await goalKpis(db, hr, {
      cycleId: s.h2.cycleId,
      groupBy: "person",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      label: "Ana Prieto",
      goals: 1,
      completed: 1,
    });
  });

  it("is not_found for a cycle that does not exist or is not an id", async () => {
    await expect(
      goalKpis(db, hr, {
        cycleId: "00000000-0000-4000-8000-000000000000",
        groupBy: "person",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      goalKpis(db, hr, { cycleId: "nope", groupBy: "person" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("goalKpis (who reads)", () => {
  it("a manager reads only their direct reports of the snapshot, never themself", async () => {
    const marta = await goalKpis(db, as(s.id.marta, "manager"), {
      cycleId: h1(),
      groupBy: "person",
    });
    expect(marta.groups.map((g) => g.label)).toEqual([
      "Ana Prieto",
      "Bruno Soler",
      "Carla Vega",
      "Dario Mena",
      "Elena Ríos",
      "Fabio Luna",
    ]);
    expect(marta.total).toMatchObject({ people: 6, goals: 26 });
    expect(marta.minGroupSize).toBeNull();
    const nora = await goalKpis(db, as(s.id.nora, "manager"), {
      cycleId: h1(),
      groupBy: "manager",
    });
    expect(nora.groups.map((g) => [g.label, g.goals])).toEqual([
      ["Nora Salas", 7],
    ]);
  });

  it("a manager's reach stays the snapshot even when the view reads today's org", async () => {
    // Ana reports to Nora today, but to Marta at the snapshot: Marta keeps
    // reading her, Nora does not.
    const nora = await goalKpis(db, as(s.id.nora, "manager"), {
      cycleId: h1(),
      groupBy: "person",
      hierarchy: "current",
    });
    expect(nora.groups.map((g) => g.label)).toEqual([
      "Gina Paz",
      "Hugo Sosa",
      "Iris Cano",
    ]);
    const marta = await goalKpis(db, as(s.id.marta, "manager"), {
      cycleId: h1(),
      groupBy: "person",
      hierarchy: "current",
    });
    expect(marta.groups.map((g) => g.label)).toContain("Ana Prieto");
  });

  it("a manager without a person, and an employee (even of their own goals), are forbidden", async () => {
    for (const actor of [
      { personId: null, role: "manager" as const },
      as(s.id.ana, "employee"),
      { personId: null, role: "employee" as const },
    ]) {
      await expect(
        goalKpis(db, actor, { cycleId: h1(), groupBy: "person" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("direction never reads people: only areas and managers over the minimum", async () => {
    await expect(
      goalKpis(db, direction, { cycleId: h1(), groupBy: "person" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    // Minimum 5 (the default): Ingeniería has 6 people, Producto 3 -> folded
    // into "Otros", which is under 5 as well, so hidden and only counted.
    const byDept = await goalKpis(db, direction, {
      cycleId: h1(),
      groupBy: "department",
    });
    expect(byDept.minGroupSize).toBe(5);
    expect(byDept.groups.map((g) => [g.label, g.others, g.people])).toEqual([
      ["Ingeniería", false, 6],
    ]);
    expect(byDept.suppressed).toBe(3);
    // The total would give the hidden group away by subtraction.
    expect(byDept.total).toBeNull();
    const byManager = await goalKpis(db, direction, {
      cycleId: h1(),
      groupBy: "manager",
    });
    // A manager is a person: the team keeps its key, not the name.
    expect(byManager.groups.map((g) => [g.key, g.label])).toEqual([
      [s.id.marta, null],
    ]);
    expect(byManager.suppressed).toBe(3);
  });

  it("direction sees every group, and the total, once the minimum allows it", async () => {
    await setSetting(db, hr, "aggregation.minGroupSize", 3);
    const { groups, total, suppressed, minGroupSize } = await goalKpis(
      db,
      direction,
      { cycleId: h1(), groupBy: "department" },
    );
    expect(minGroupSize).toBe(3);
    expect(groups.map((g) => [g.label, g.people])).toEqual([
      ["Ingeniería", 6],
      ["Producto", 3],
    ]);
    expect(suppressed).toBe(0);
    expect(total).toMatchObject({ people: 9, goals: 33 });
  });

  it("a config override replaces the minimum group size setting for that call (the export's own)", async () => {
    // The setting stays at its default 5; the override asks for 3.
    const input = { cycleId: h1(), groupBy: "department" as const };
    const config = { minGroupSize: 3 };
    const kpis = await goalKpis(db, direction, { ...input, config });
    expect(kpis.minGroupSize).toBe(3);
    expect(kpis.groups.map((g) => [g.label, g.people])).toEqual([
      ["Ingeniería", 6],
      ["Producto", 3],
    ]);
    expect(kpis.total).toMatchObject({ people: 9 });
    const all = await goalInsights(db, direction, { ...input, config });
    expect(all.kpis.minGroupSize).toBe(3);
    expect(all.vsIndicators.minGroupSize).toBe(3);
    expect(all.outliers.minGroupSize).toBe(3);
    // Without it, the setting still rules.
    expect((await goalKpis(db, direction, input)).minGroupSize).toBe(5);
    // People are not masked by it.
    expect(
      (await goalKpis(db, hr, { ...input, config: { minGroupSize: 40 } }))
        .minGroupSize,
    ).toBeNull();
  });

  it("direction reads today's org too: with Ana in Producto both areas reach 4", async () => {
    await setSetting(db, hr, "aggregation.minGroupSize", 4);
    const shown = await goalKpis(db, direction, {
      cycleId: h1(),
      groupBy: "department",
      hierarchy: "current",
    });
    expect(shown.groups.map((g) => [g.label, g.people])).toEqual([
      ["Ingeniería", 5],
      ["Producto", 4],
    ]);
    // At the snapshot Nora has 3 people: under 4, hidden (and only counted).
    const hidden = await goalKpis(db, direction, {
      cycleId: h1(),
      groupBy: "manager",
    });
    expect(hidden.groups.map((g) => g.key)).toEqual([s.id.marta]);
    expect(hidden.groups.map((g) => g.label)).toEqual([null]);
    expect(hidden.suppressed).toBe(3);
  });
});

describe("goalInsightsFilterOptions", () => {
  it("lists what the actor reads: People all, a manager their own, direction areas only", async () => {
    const all = await goalInsightsFilterOptions(db, hr, { cycleId: h1() });
    expect(all.departments).toEqual(["Ingeniería", "Producto"]);
    expect(all.managers.map((m) => m.name)).toEqual([
      "Marta Quiroga",
      "Nora Salas",
    ]);
    const marta = await goalInsightsFilterOptions(
      db,
      as(s.id.marta, "manager"),
      {
        cycleId: h1(),
      },
    );
    expect(marta.departments).toEqual(["Ingeniería"]);
    expect(marta.managers.map((m) => m.name)).toEqual(["Marta Quiroga"]);
    const dir = await goalInsightsFilterOptions(db, direction, {
      cycleId: h1(),
    });
    expect(dir.departments).toEqual(["Ingeniería", "Producto"]);
    expect(dir.managers).toEqual([]);
    await expect(
      goalInsightsFilterOptions(db, as(s.id.ana, "employee"), {
        cycleId: h1(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
