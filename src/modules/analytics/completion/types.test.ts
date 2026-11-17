import { describe, expect, it } from "vitest";
import { deltaPoints, isMissing, rateOf, withRates } from "./types";

describe("completion helpers", () => {
  it("rateOf is submitted over the sides that apply, null when none do", () => {
    expect(rateOf(2, 4)).toBe(0.5);
    expect(rateOf(0, 3)).toBe(0);
    expect(rateOf(0, 0)).toBeNull();
  });

  it("withRates derives both rates from the counts", () => {
    const g = withRates("Ventas", "Ventas", {
      participants: 5,
      selfSubmitted: 3,
      selfApplicable: 4,
      managerSubmitted: 0,
      managerApplicable: 0,
    });
    expect(g).toMatchObject({
      key: "Ventas",
      selfRate: 0.75,
      managerRate: null,
    });
  });

  it("deltaPoints is the difference in percentage points, one decimal", () => {
    expect(deltaPoints(2 / 3, 0.5)).toBe(16.7);
    expect(deltaPoints(0.4, 2 / 3)).toBe(-26.7);
    expect(deltaPoints(1, 0)).toBe(100);
    expect(deltaPoints(null, 0.5)).toBeNull();
    expect(deltaPoints(0.5, null)).toBeNull();
  });

  it("a side is missing when it applies and is not submitted", () => {
    expect(isMissing("not_started")).toBe(true);
    expect(isMissing("in_progress")).toBe(true);
    expect(isMissing("submitted")).toBe(false);
    expect(isMissing("not_applicable")).toBe(false);
  });
});
