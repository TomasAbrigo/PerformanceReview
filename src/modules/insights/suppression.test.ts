import { describe, expect, it } from "vitest";
import { solvable } from "./suppression-attack";
import { suppressList, suppressTable } from "./suppression";

const mask = (truth: number[][], hidden: boolean[][]) =>
  truth.map((row, r) => row.map((v, c) => (hidden[r][c] ? null : v)));

describe("suppressTable", () => {
  it("the audit case: one small cell is no longer 277 - 276", () => {
    // retention low/mid/high × engagement low/mid/high (cycle 001f654c…).
    const truth = [
      [24, 14, 16],
      [0, 36, 28],
      [1, 30, 128],
    ];
    const hidden = suppressTable(truth, 5)!;
    expect(hidden[2][0]).toBe(true);
    expect(solvable(mask(truth, hidden), truth)).toEqual([]);
  });

  it("hides nothing when no cell is under the minimum", () => {
    const truth = [
      [5, 0],
      [6, 9],
    ];
    expect(suppressTable(truth, 5)).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  it("no masked cell is solvable, over many tables", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let n = 0; n < 300; n++) {
      const truth = [0, 1, 2].map(() =>
        [0, 1, 2].map(() => {
          const x = rnd();
          return x < 0.25
            ? 0
            : x < 0.6
              ? 1 + Math.floor(rnd() * 4)
              : 5 + Math.floor(rnd() * 8);
        }),
      );
      const hidden = suppressTable(truth, 5);
      if (hidden === null) continue; // the caller hides it all
      expect(
        solvable(mask(truth, hidden), truth),
        JSON.stringify(truth),
      ).toEqual([]);
      truth.forEach((row, r) =>
        row.forEach((v, c) => {
          if (v > 0 && v < 5) expect(hidden[r][c]).toBe(true);
        }),
      );
    }
  });

  it("gives up (null) when a lone small cell cannot be covered", () => {
    expect(
      suppressTable(
        [
          [2, 0],
          [0, 9],
        ],
        5,
      ),
    ).toBeNull();
  });
});

describe("suppressList", () => {
  const solvableList = (counts: number[], hidden: boolean[]) => {
    // Sum public, hidden >= 1: a hidden entry is solvable when alone or when
    // every hidden entry must be 1.
    const shut = counts.filter((_, i) => hidden[i]);
    const left = shut.reduce((a, b) => a + b, 0);
    return shut.length === 1 || (shut.length > 1 && left === shut.length);
  };

  it("a single small bucket takes the smallest shown one with it", () => {
    const counts = [0, 12, 4, 30, 9];
    const hidden = suppressList(counts, 5)!;
    expect(hidden).toEqual([false, false, true, false, true]);
    expect(solvableList(counts, hidden)).toBe(false);
  });

  it("two buckets of one person each are not left alone", () => {
    const counts = [1, 1, 20, 6];
    const hidden = suppressList(counts, 5)!;
    expect(hidden).toEqual([true, true, false, true]);
    expect(solvableList(counts, hidden)).toBe(false);
  });

  it("null when everything is under the minimum", () => {
    expect(suppressList([3, 0], 5)).toBeNull();
  });
});
