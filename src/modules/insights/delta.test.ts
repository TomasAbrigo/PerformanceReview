import { describe, expect, it } from "vitest";
import { shownDelta } from "./delta";

describe("shownDelta (#133)", () => {
  it("is computed on the unrounded values and rounded to the precision shown", () => {
    // 83,33 % vs 85,75 %: −2,4 pp, not 83 − 86 = −3.
    expect(shownDelta({ now: 83.33, before: 85.75, decimals: 1 })).toBe(-2.4);
    expect(shownDelta({ now: 83.33, before: 85.75, decimals: 0 })).toBe(-2);
  });

  it("a change smaller than the unit shown is flat (0), never a signed zero", () => {
    expect(shownDelta({ now: 3.6787, before: 3.6633, decimals: 1 })).toBe(0);
    expect(
      Object.is(shownDelta({ now: 3.6101, before: 3.6133, decimals: 1 }), -0),
    ).toBe(false);
    // −0,053 rounds to −0,1: a change of the unit shown.
    expect(shownDelta({ now: 3.6101, before: 3.6633, decimals: 1 })).toBe(-0.1);
  });

  it("is flat under a minimum change (the noise of the scale)", () => {
    expect(
      shownDelta({ now: 3.61, before: 3.66, decimals: 1, minChange: 0.1 }),
    ).toBe(0);
    expect(
      shownDelta({ now: 3.5, before: 3.66, decimals: 1, minChange: 0.1 }),
    ).toBe(-0.2);
  });

  it("is none when either side is missing or counts fewer people than the minimum", () => {
    expect(shownDelta({ now: 50, before: null, decimals: 0 })).toBeNull();
    expect(
      shownDelta({ now: 0, before: 100, decimals: 0, n: [1, 12], minN: 5 }),
    ).toBeNull();
    expect(
      shownDelta({ now: 0, before: 100, decimals: 0, n: [12, 12], minN: 5 }),
    ).toBe(-100);
  });
});
