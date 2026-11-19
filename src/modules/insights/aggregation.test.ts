import { describe, expect, it } from "vitest";
import { foldGroups, foldSmallGroups, type GroupCell } from "./aggregation";

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

  it("never hides Otros while the total is public: the smallest shown group joins it (#130)", () => {
    const groups = [
      group("Ventas", 6, 0.5, [0, 0, 6, 0, 0]),
      group("Marketing", 9, 0.5, [0, 0, 9, 0, 0]),
      group("Soporte", 2, 0.5, [0, 0, 0, 2, 0]),
      group("Legales", 1, 0.5, [0, 0, 0, 1, 0]),
    ];
    const r = foldSmallGroups(groups, 5);
    // Try to solve for a hidden group: total minus what is shown.
    const total = groups.reduce((s, g) => s + g.n, 0);
    const shown = r.shown.reduce((s, g) => s + g.n, 0) + (r.others?.n ?? 0);
    expect(total - shown).toBe(0);
    expect(r.suppressed).toBe(0);
    expect(r.shown.map((g) => g.key)).toEqual(["Marketing"]);
    expect(r.others).toMatchObject({ n: 9, counts: [0, 0, 6, 3, 0] });
  });

  it("leaves out only a whole under the minimum", () => {
    const r = foldSmallGroups([group("Soporte", 2), group("Legales", 1)], 5);
    expect(r.shown).toEqual([]);
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

describe("foldGroups", () => {
  const opts = {
    size: (g: { k: string; n: number }) => g.n,
    merge: (rest: { k: string; n: number }[]) => ({
      k: "Otros",
      n: rest.reduce((s, r) => s + r.n, 0),
    }),
  };
  const groups = [
    { k: "a", n: 6 },
    { k: "b", n: 3 },
    { k: "c", n: 2 },
  ];
  it("folds small groups into Otros, or suppresses them when Otros is still small", () => {
    expect(foldGroups(groups, 5, opts)).toEqual({
      shown: [{ k: "a", n: 6 }],
      others: { k: "Otros", n: 5 },
      suppressed: 0,
    });
    expect(foldGroups(groups, 6, opts)).toEqual({
      shown: [{ k: "a", n: 6 }],
      others: null,
      suppressed: 5,
    });
  });
  it("folds unnamed groups whatever their size", () => {
    expect(
      foldGroups(groups, 1, { ...opts, named: (g) => g.k !== "a" }).others,
    ).toEqual({ k: "Otros", n: 6 });
  });
});
