import { describe, expect, it } from "vitest";
import { LOW_BASE_N, standsOut, wilson } from "./rank";

describe("wilson (#133)", () => {
  it("is the 95 % Wilson interval of a share", () => {
    // 4 of 12: 14 %-61 % (the audit's Soporte).
    const { low, high } = wilson(4, 12);
    expect(low).toBeCloseTo(0.138, 2);
    expect(high).toBeCloseTo(0.609, 2);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it("narrows with more people", () => {
    expect(wilson(8, 41).low).toBeGreaterThan(wilson(2, 10).low);
  });
});

describe("standsOut", () => {
  it("only a group whose interval clears the share of everyone, with enough people", () => {
    // Soporte 4/12 vs 14 % overall: within the noise.
    expect(standsOut(4, 12, 0.14)).toBe(false);
    // 20 of 40 vs 14 %: clearly above.
    expect(standsOut(20, 40, 0.14)).toBe(true);
    // Under the low base: never, however large.
    expect(standsOut(LOW_BASE_N - 1, LOW_BASE_N - 1, 0.1)).toBe(false);
  });
});
