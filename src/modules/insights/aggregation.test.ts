import { describe, expect, it } from "vitest";
import { foldSmallGroups, type GroupCell } from "./aggregation";

const group = (
  key: string | null,
  n: number,
  mean: number | null = 0.5,
  counts = [0, 0, n, 0, 0],
): GroupCell => ({ key, n, mean, counts });

describe("foldSmallGroups", () => {
  it("lists the groups with at least the minimum and folds the rest into Otros", () => {
    const r = foldSmallGroups(
      [group("Ventas", 6), group("Soporte", 3, 0.2), group("Legales", 2, 0.8)],
      5,
    );
    expect(r.shown.map((g) => g.key)).toEqual(["Ventas"]);
    // 3 + 2 = 5 people: not under the minimum any more, so shown together.
    expect(r.others).toEqual({
      n: 5,
      mean: (3 * 0.2 + 2 * 0.8) / 5,
      counts: [0, 0, 5, 0, 0],
    });
    expect(r.suppressed).toBe(0);
  });

  it("hides Otros too when the folded groups together are still under the minimum", () => {
    const r = foldSmallGroups(
      [group("Ventas", 6), group("Soporte", 2), group("Legales", 1)],
      5,
    );
    expect(r.shown.map((g) => g.key)).toEqual(["Ventas"]);
    expect(r.others).toBeNull();
    expect(r.suppressed).toBe(3);
  });

  it("a group at exactly the minimum is shown", () => {
    const r = foldSmallGroups([group("Ventas", 5)], 5);
    expect(r.shown).toHaveLength(1);
    expect(r.others).toBeNull();
    expect(r.suppressed).toBe(0);
  });

  it("people without a department go to Otros, never listed by name", () => {
    const r = foldSmallGroups([group("Ventas", 6), group(null, 5)], 5);
    expect(r.shown.map((g) => g.key)).toEqual(["Ventas"]);
    expect(r.others).toMatchObject({ n: 5 });
  });

  it("with a minimum of 1 (People) only the unnamed group is folded", () => {
    const r = foldSmallGroups(
      [group("Ventas", 1), group("Soporte", 2), group(null, 1)],
      1,
    );
    expect(r.shown.map((g) => g.key)).toEqual(["Ventas", "Soporte"]);
    expect(r.others).toMatchObject({ n: 1 });
    expect(r.suppressed).toBe(0);
  });

  it("does not mutate its input and handles no groups", () => {
    const groups = [group("Ventas", 1)];
    foldSmallGroups(groups, 5);
    expect(groups).toEqual([group("Ventas", 1)]);
    expect(foldSmallGroups([], 5)).toEqual({
      shown: [],
      others: null,
      suppressed: 0,
    });
  });

  it("a folded group without a mean does not break the average", () => {
    const r = foldSmallGroups([group("A", 3, null), group("B", 2, 0.5)], 5);
    expect(r.others?.mean).toBeCloseTo(0.5);
  });
});
