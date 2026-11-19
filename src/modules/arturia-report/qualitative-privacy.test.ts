import { describe, expect, it } from "vitest";
import { solvable } from "@/modules/insights/suppression-attack";
import {
  foldCut,
  hideSmall,
  maskCells,
  maskColumns,
  maskPair,
  maskTable,
  notValuedOf,
  type CutGroup,
} from "./qualitative-privacy";

/** Every value a hidden cell of a list with a public sum can take (hidden ones hold 1+). */
function possibleValues(
  shown: readonly (number | null)[],
  sum: number,
): Set<number>[] {
  const hidden = shown.flatMap((v, i) => (v === null ? [i] : []));
  const room = sum - shown.reduce<number>((a, v) => a + (v ?? 0), 0);
  const found = hidden.map(() => new Set<number>());
  const walk = (i: number, left: number, acc: number[]) => {
    if (i === hidden.length) {
      if (left === 0) acc.forEach((v, j) => found[j].add(v));
      return;
    }
    for (let v = 1; v <= left; v++) walk(i + 1, left - v, [...acc, v]);
  };
  walk(0, room, []);
  return found;
}

describe("maskCells (a distribution whose sum is public)", () => {
  it("hides nothing for the named report (minimum 1)", () => {
    expect(maskCells([1, 0, 9], 1)).toEqual([1, 0, 9]);
  });

  it("hides what is under the minimum and the complement, so no cell is solvable", () => {
    const cases = [
      [3, 40, 90],
      [1, 2, 130],
      [0, 4, 4, 60],
      [2, 2, 2, 2, 50],
      [90, 4],
    ];
    for (const counts of cases) {
      const masked = maskCells(counts, 5);
      expect(masked, counts.join()).not.toBeNull();
      for (const [i, v] of masked!.entries()) {
        // what is shown is the truth and is not under the minimum
        if (v !== null) {
          expect(v).toBe(counts[i]);
          expect(v === 0 || v >= 5).toBe(true);
        }
      }
      const sum = counts.reduce((a, b) => a + b, 0);
      for (const values of possibleValues(masked!, sum)) {
        expect(values.size, counts.join()).toBeGreaterThan(1);
      }
    }
  });

  it("an empty cell is shown as 0 (nobody to protect)", () => {
    expect(maskCells([0, 60, 70], 5)).toEqual([0, 60, 70]);
  });

  it("returns null when not even hiding everything protects the cells: the row goes", () => {
    expect(maskCells([1, 1, 1, 1], 3)).toBeNull();
    expect(maskCells([3], 5)).toBeNull();
  });
});

describe("hideSmall and maskPair", () => {
  it("hides a count under the minimum, not a zero", () => {
    expect(hideSmall(4, 5)).toBeNull();
    expect(hideSmall(5, 5)).toBe(5);
    expect(hideSmall(0, 5)).toBe(0);
    expect(hideSmall(3, 1)).toBe(3);
  });

  it("a count is published only if neither it nor its complement is under the minimum", () => {
    expect(maskPair(40, 100, 5)).toBe(40);
    expect(maskPair(3, 100, 5)).toBeNull();
    expect(maskPair(98, 100, 5)).toBeNull();
    expect(maskPair(0, 100, 5)).toBe(0);
    expect(maskPair(100, 100, 5)).toBe(100);
    expect(maskPair(3, 100, 1)).toBe(3);
  });
});

describe("foldCut (a cut by group)", () => {
  type Cells = { n: number };
  const g = (key: string | null, people: number): CutGroup<Cells> => ({
    key,
    label: key ?? "x",
    people,
    cells: { n: people },
  });
  const merge = (rest: readonly CutGroup<Cells>[]): CutGroup<Cells> => ({
    key: null,
    label: "Otros",
    people: rest.reduce((n, x) => n + x.people, 0),
    cells: { n: rest.reduce((n, x) => n + x.cells.n, 0) },
  });

  it("folds the small and the unnamed groups into Otros, and the smallest shown ones join it until it reaches the minimum", () => {
    const out = foldCut(
      [g("a", 30), g("b", 8), g("c", 2), g(null, 1)],
      5,
      merge,
    );
    // Otros would hold 3 people: b joins it (8 + 3 = 11)
    expect(out.shown.map((x) => x.key)).toEqual(["a"]);
    expect(out.others?.people).toBe(11);
    expect(out.suppressed).toBe(0);
    // nothing is lost: what is shown adds up to the whole
    const total = [...out.shown, out.others!].reduce((n, x) => n + x.people, 0);
    expect(total).toBe(41);
  });

  it("leaves the whole out when it is under the minimum", () => {
    const out = foldCut([g("a", 2), g("b", 1)], 5, merge);
    expect(out.shown).toEqual([]);
    expect(out.others).toBeNull();
    expect(out.suppressed).toBe(3);
  });

  it("with a minimum of 1 only the unnamed group is folded", () => {
    const out = foldCut([g("a", 3), g(null, 2)], 1, merge);
    expect(out.shown.map((x) => x.key)).toEqual(["a"]);
    expect(out.others?.people).toBe(2);
  });
});

describe("maskTable (groups by answer, row and column totals public)", () => {
  it("hides nothing for the named report (minimum 1)", () => {
    expect(
      maskTable(
        [
          [1, 2],
          [0, 9],
        ],
        1,
      ),
    ).toEqual([
      [1, 2],
      [0, 9],
    ]);
  });

  it("hides the small cells and the ones that would give them away: nobody can solve for a hidden cell", () => {
    const cases = [
      [
        [30, 3],
        [40, 2],
        [20, 60],
      ],
      [
        [10, 4],
        [12, 9],
        [8, 7],
      ],
      [
        [2, 3, 50, 40],
        [1, 5, 30, 59],
        [30, 30, 30, 30],
      ],
    ];
    for (const truth of cases) {
      const masked = maskTable(truth, 5);
      expect(masked, JSON.stringify(truth)).not.toBeNull();
      expect(solvable(masked!, truth), JSON.stringify(truth)).toEqual([]);
      masked!.forEach((row, r) =>
        row.forEach((v, c) => {
          if (v === null) return;
          // what is shown is the truth, and is not under the minimum
          expect(v).toBe(truth[r][c]);
          expect(v === 0 || v >= 5).toBe(true);
        }),
      );
      // something is hidden when something was under the minimum
      if (truth.flat().some((v) => v > 0 && v < 5)) {
        expect(masked!.flat().some((v) => v === null)).toBe(true);
      }
    }
  });

  it("a table that cannot be protected is null: the caller leaves it out (a shown 0 would be the row total)", () => {
    expect(maskTable([[1, 1, 0]], 5)).toBeNull();
    expect(
      maskTable(
        [
          [25, 1],
          [30, 1],
          [28, 0],
        ],
        5,
      ),
    ).toBeNull();
    // a single group: its cells are the column totals
    expect(maskTable([[2, 3, 9, 7]], 8)).toBeNull();
  });
});

describe("notValuedOf (the share at values 1-2 next to hidden cells)", () => {
  it("is published when nothing is hidden, when only 1 and 2 are, or when neither is", () => {
    expect(notValuedOf([10, 20, 30, 40], 30)).toBe(30);
    expect(notValuedOf([null, null, 30, 40], 25)).toBe(25);
    expect(notValuedOf([10, 20, null, 40], 30)).toBe(30);
    expect(notValuedOf([10, 20, null, null], 30)).toBe(30);
  });

  it("is not when it would give a hidden cell away", () => {
    // 1 hidden, 2 shown: the sum solves for 1
    expect(notValuedOf([null, 20, 30, 40], 25)).toBeNull();
    // 1 and 2 hidden, 3 hidden too: the sum solves for 3 from the hidden total
    expect(notValuedOf([null, null, null, 40], 25)).toBeNull();
  });
});

describe("maskColumns (a table of groups whose column totals are public)", () => {
  it("hides, per column, the small cells and the complement", () => {
    const table = [
      [30, 3, 0],
      [40, 60, 0],
      [20, 50, 7],
    ];
    const { cells: masked, unprotected } = maskColumns(table, 5);
    // the column with the 3 (and the smallest shown, 50) hides two cells
    expect(masked.map((r) => r[1])).toEqual([null, 60, null]);
    // the other columns: nothing under the minimum
    expect(masked.map((r) => r[0])).toEqual([30, 40, 20]);
    expect(unprotected).toEqual([false, false, false]);
    // a hidden count is never a number
    for (const row of masked)
      for (const v of row) expect(v === null || v >= 0).toBe(true);
  });

  it("a column that cannot be protected is hidden entirely", () => {
    const { cells, unprotected } = maskColumns(
      [
        [1, 9],
        [1, 9],
      ],
      5,
    );
    expect(cells.map((r) => r[0])).toEqual([null, null]);
    expect(cells.map((r) => r[1])).toEqual([9, 9]);
    // its total must go too: the caller leaves that row out
    expect(unprotected).toEqual([true, false]);
  });
});
