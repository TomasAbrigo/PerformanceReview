import { describe, expect, it } from "vitest";
import {
  bucketRows,
  filterOptionsOf,
  filterRows,
  kpisOf,
  outlierRows,
  outlierThresholds,
} from "./derive";
import type { GoalIndicatorRow } from "./types";

const M1 = "00000000-0000-4000-8000-0000000000a1";
const M2 = "00000000-0000-4000-8000-0000000000a2";

let n = 0;
/** A participant with `completed` of `goals` goals done (the rest in progress). */
const row = (
  name: string,
  goals: number,
  completed: number,
  extra: Partial<GoalIndicatorRow> = {},
): GoalIndicatorRow => {
  n += 1;
  return {
    participantId: `p${n}`,
    personId: `person${n}`,
    name,
    managerId: M1,
    managerName: "Marta",
    department: "Ingeniería",
    goals,
    completed,
    inProgress: goals - completed,
    closed: 0,
    overdue: 0,
    progressSum: completed * 100,
    completedPct: goals ? (completed / goals) * 100 : null,
    avgProgress: goals ? (completed * 100) / goals : null,
    retention: 3,
    engagement: 3,
    positiveShare: null,
    labeledComments: 0,
    ...extra,
  };
};

const rows = [
  row("Ana", 5, 4, { retention: 2, engagement: 4, positiveShare: 0.5 }),
  row("Bruno", 4, 1, {
    overdue: 1,
    managerId: M2,
    managerName: "Nora",
    department: "Producto",
  }),
  row("Carla", 10, 3, { retention: 5, engagement: 5 }),
  row("Dario", 0, 0),
  row("Elena", 2, 2, { retention: 1, engagement: null, department: null }),
];

describe("filterRows / filterOptionsOf", () => {
  it("narrows to an area and a manager; an id that is not a uuid is no filter", () => {
    expect(
      filterRows(rows, { department: "Producto" }).map((r) => r.name),
    ).toEqual(["Bruno"]);
    expect(filterRows(rows, { managerId: M2 }).map((r) => r.name)).toEqual([
      "Bruno",
    ]);
    expect(filterRows(rows, { managerId: "nope" })).toHaveLength(5);
    expect(filterRows(rows)).toHaveLength(5);
  });

  it("lists the areas, and the managers only for readers that may name people", () => {
    expect(filterOptionsOf(rows, true)).toEqual({
      departments: ["Ingeniería", "Producto"],
      managers: [
        { id: M1, name: "Marta" },
        { id: M2, name: "Nora" },
      ],
    });
    expect(filterOptionsOf(rows, false).managers).toEqual([]);
  });
});

describe("kpisOf", () => {
  it("adds the rows of each group up and shares the group's goals", () => {
    const { groups, total } = kpisOf(rows, "manager", null);
    // Marta: Ana, Carla, Dario, Elena: 17 goals, 9 completed.
    const marta = groups.find((g) => g.label === "Marta")!;
    expect(marta).toMatchObject({
      people: 4,
      peopleWithGoals: 3,
      goals: 17,
      completed: 9,
    });
    expect(marta.completedPct).toBeCloseTo((9 / 17) * 100);
    expect(total).toMatchObject({
      people: 5,
      goals: 21,
      completed: 10,
      overdue: 1,
    });
  });

  it("puts people without a department in an unnamed group", () => {
    const { groups } = kpisOf(rows, "department", null);
    expect(groups.map((g) => g.label)).toEqual([
      "Ingeniería",
      "Producto",
      null,
    ]);
  });

  it("with a minimum a team keeps its key but never its manager's name", () => {
    const named = kpisOf(rows, "manager", null).groups;
    expect(named.map((g) => g.label)).toEqual(["Marta", "Nora"]);
    const masked = kpisOf(rows, "manager", 1);
    expect(masked.groups.map((g) => [g.key, g.label, g.people])).toEqual([
      [M1, null, 4],
      [M2, null, 1],
    ]);
    expect(masked.total).not.toBeNull();
    // the area keeps its name (it is not a person); the unnamed one is "Otros"
    expect(kpisOf(rows, "department", 1).groups.map((g) => g.label)).toEqual([
      "Ingeniería",
      "Producto",
      null,
    ]);
    // equal labels (none) fall back to the key, so the order is stable
    const [a, b] = kpisOf([...rows].reverse(), "manager", 1).groups;
    expect([a.key, b.key]).toEqual([M1, M2]);
  });

  it("with a minimum folds and hides like the aggregate views do", () => {
    const { groups, total, suppressed, minGroupSize } = kpisOf(
      rows,
      "department",
      3,
    );
    expect(minGroupSize).toBe(3);
    // Ingeniería has 3 people; Producto (1) and unnamed (1) are 2 < 3: hidden.
    expect(groups.map((g) => g.label)).toEqual(["Ingeniería"]);
    expect(suppressed).toBe(2);
    expect(total).toBeNull();
  });
});

describe("bucketRows", () => {
  it("puts people with goals in their 20-point bucket and counts the rest apart", () => {
    const { buckets, withoutGoals, suppressed } = bucketRows(rows, null);
    // Ana 80 % -> 4, Bruno 25 % -> 1, Carla 30 % -> 1, Elena 100 % -> 4.
    expect(buckets.map((b) => b.people)).toEqual([0, 2, 0, 0, 2]);
    expect(withoutGoals).toBe(1);
    expect(suppressed).toBe(0);
    // Bucket 1: retention (3 + 5) / 2, engagement (3 + 5) / 2.
    expect(buckets[1]).toMatchObject({ meanRetention: 4, meanEngagement: 4 });
    // Bucket 4: retention (2 + 1) / 2; engagement only Ana's 4.
    expect(buckets[4]).toMatchObject({
      meanRetention: 1.5,
      meanEngagement: 4,
      meanPositiveShare: 0.5,
    });
  });

  it("hides the small buckets for direction and leaves the empty ones alone", () => {
    const { buckets, withoutGoals, suppressed } = bucketRows(rows, 3);
    expect(buckets.map((b) => [b.people, b.hidden])).toEqual([
      [0, false],
      [null, true],
      [0, false],
      [0, false],
      [null, true],
    ]);
    expect(withoutGoals).toBeNull();
    expect(suppressed).toBe(4);
  });
});

describe("outlierRows", () => {
  const thresholds = outlierThresholds(2);

  it("finds done-but-low and behind-but-high, in whole numbers", () => {
    const { doneButLow, behindButHigh } = outlierRows(rows, thresholds, null);
    // Ana 80 % with retention 2; Elena 100 % with retention 1 (lowest first
    // within the same share; 100 % goes before 80 %).
    expect(doneButLow.people.map((p) => p.name)).toEqual(["Elena", "Ana"]);
    // Carla: exactly 30 % with 5 / 5.
    expect(behindButHigh.people.map((p) => p.name)).toEqual(["Carla"]);
    expect(doneButLow.count).toBe(2);
  });

  it("the thresholds can be replaced", () => {
    expect(outlierThresholds(2, { goalsHigh: 100, indicatorHigh: 3 })).toEqual({
      goalsHigh: 100,
      goalsLow: 30,
      riskThreshold: 2,
      indicatorHigh: 3,
    });
    const strict = outlierRows(
      rows,
      outlierThresholds(2, { goalsHigh: 100 }),
      null,
    );
    expect(strict.doneButLow.people.map((p) => p.name)).toEqual(["Elena"]);
  });

  it("gives direction a count over the minimum and never a person", () => {
    const loose = outlierRows(rows, thresholds, 2);
    expect(loose.doneButLow).toEqual({ count: 2, people: [] });
    expect(loose.behindButHigh).toEqual({ count: null, people: [] });
  });
});
