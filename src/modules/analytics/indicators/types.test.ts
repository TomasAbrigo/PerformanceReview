import { describe, expect, it } from "vitest";
import { bandOf, bandRange } from "./types";

describe("bandOf", () => {
  it("is low up to the risk threshold, high from its mirror value, mid between", () => {
    expect([1, 2, 3, 4, 5].map((v) => bandOf(v, 2))).toEqual([
      "low",
      "low",
      "mid",
      "high",
      "high",
    ]);
    expect([1, 2, 3, 4, 5].map((v) => bandOf(v, 1))).toEqual([
      "low",
      "mid",
      "mid",
      "mid",
      "high",
    ]);
  });

  it("a high threshold leaves no mid band: low wins up to it", () => {
    expect([1, 2, 3, 4, 5].map((v) => bandOf(v, 3))).toEqual([
      "low",
      "low",
      "low",
      "high",
      "high",
    ]);
    expect([1, 2, 3, 4, 5].map((v) => bandOf(v, 5))).toEqual(
      Array(5).fill("low"),
    );
  });
});

describe("bandRange", () => {
  it("is the values bandOf puts in each band", () => {
    for (const threshold of [1, 2, 3, 5]) {
      for (const band of ["low", "mid", "high"] as const) {
        const range = bandRange(band, threshold);
        const values = [1, 2, 3, 4, 5].filter(
          (v) => bandOf(v, threshold) === band,
        );
        expect(range === null ? [] : [range[0], range[1]]).toEqual(
          values.length ? [values[0], values[values.length - 1]] : [],
        );
      }
    }
  });
});
