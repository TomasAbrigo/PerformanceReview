import { describe, expect, it } from "vitest";
import { foldKpiGroups, kpiGroup } from "./kpi";
import { bucketOf, buckets } from "./types";

const raw = (
  key: string | null,
  people: number,
  goals: number,
  completed: number,
  extra: Partial<Parameters<typeof kpiGroup>[0]> = {},
) =>
  kpiGroup({
    key,
    label: key,
    people,
    peopleWithGoals: people,
    goals,
    completed,
    inProgress: goals - completed,
    closed: 0,
    overdue: 0,
    progressSum: completed * 100,
    ...extra,
  });

describe("kpiGroup", () => {
  it("turns counts into shares of the goals and a mean progress", () => {
    const g = kpiGroup({
      key: "a",
      label: "A",
      people: 2,
      peopleWithGoals: 2,
      goals: 4,
      completed: 1,
      inProgress: 3,
      closed: 0,
      overdue: 2,
      progressSum: 100 + 50 + 20 + 30,
    });
    expect(g).toMatchObject({
      completedPct: 25,
      inProgressPct: 75,
      overduePct: 50,
      avgProgress: 50,
      others: false,
    });
  });

  it("has no shares without goals", () => {
    const g = raw("a", 1, 0, 0);
    expect(g).toMatchObject({
      goals: 0,
      completedPct: null,
      inProgressPct: null,
      overduePct: null,
      avgProgress: null,
    });
  });
});

describe("foldKpiGroups", () => {
  it("keeps the groups with at least the minimum and folds the rest into Otros", () => {
    const { shown, others, suppressed } = foldKpiGroups(
      [
        raw("big", 5, 10, 5),
        raw("s1", 3, 6, 3),
        raw("s2", 2, 4, 0),
        raw(null, 1, 2, 2),
      ],
      5,
    );
    expect(shown.map((g) => g.key)).toEqual(["big"]);
    expect(others).toMatchObject({
      others: true,
      key: null,
      people: 6,
      goals: 12,
      completed: 5,
    });
    // Shares are recomputed from the sums: 5 of 12 completed.
    expect(others!.completedPct).toBeCloseTo((5 / 12) * 100);
    expect(suppressed).toBe(0);
  });

  it("hides Otros when it is still under the minimum and only counts its people", () => {
    const { shown, others, suppressed } = foldKpiGroups(
      [raw("big", 6, 6, 6), raw("s1", 2, 2, 2), raw("s2", 1, 1, 1)],
      5,
    );
    expect(shown.map((g) => g.key)).toEqual(["big"]);
    expect(others).toBeNull();
    expect(suppressed).toBe(3);
  });

  it("folds only the unnamed group with a minimum of 1", () => {
    const { shown, others } = foldKpiGroups(
      [raw("a", 1, 1, 1), raw(null, 2, 2, 1)],
      1,
    );
    expect(shown.map((g) => g.key)).toEqual(["a"]);
    expect(others?.people).toBe(2);
  });

  it("never shows a group of fewer people than the minimum", () => {
    const groups = [raw("a", 4, 4, 4), raw("b", 4, 4, 0), raw("c", 5, 5, 5)];
    const { shown, others } = foldKpiGroups(groups, 5);
    expect(shown.map((g) => g.key)).toEqual(["c"]);
    expect(others?.people).toBe(8);
  });
});

describe("completion buckets", () => {
  it("has five 20-point buckets from 0 to 100", () => {
    expect(buckets.map((b) => [b.from, b.to])).toEqual([
      [0, 20],
      [20, 40],
      [40, 60],
      [60, 80],
      [80, 100],
    ]);
  });

  it.each([
    [0, 4, 0],
    [1, 5, 1],
    [1, 10, 0],
    [2, 5, 2],
    [3, 5, 3],
    [4, 5, 4],
    [5, 5, 4],
    [7, 10, 3],
    [1, 3, 1],
  ])("puts %i of %i completed goals in bucket %i", (completed, goals, want) => {
    expect(bucketOf(completed, goals)).toBe(want);
  });
});
