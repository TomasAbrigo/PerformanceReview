import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/modules/settings/definitions";
import { atRiskTone, kpiThresholds, likertTone, percentTone } from "./tone";

describe("likertTone", () => {
  // Default risk threshold 2: 1-2 risk, 3 watch, 4-5 good (bands of the matrix).
  it.each([
    [1, "risk"],
    [2, "risk"],
    [2.4, "watch"],
    [3, "watch"],
    [3.9, "watch"],
    [4, "good"],
    [5, "good"],
  ] as const)("%s on 1-5 with threshold 2 is %s", (mean, tone) => {
    expect(likertTone(mean, 2)).toBe(tone);
  });
  it("follows the risk threshold of the settings", () => {
    expect(likertTone(3, 3)).toBe("risk");
    expect(likertTone(3.5, 3)).toBe("watch");
    expect(likertTone(4, 3)).toBe("good");
  });
});

describe("percentTone", () => {
  const t = kpiThresholds(DEFAULT_SETTINGS);
  it("reads the defaults: good from 80 %, risk under 50 %", () => {
    expect(t).toEqual({ goodPct: 80, watchPct: 50 });
    expect(percentTone(80, t)).toBe("good");
    expect(percentTone(79.9, t)).toBe("watch");
    expect(percentTone(50, t)).toBe("watch");
    expect(percentTone(49, t)).toBe("risk");
  });
  it("flips when lower is better (overdue goals)", () => {
    expect(percentTone(10, t, "down")).toBe("good");
    expect(percentTone(30, t, "down")).toBe("watch");
    expect(percentTone(60, t, "down")).toBe("risk");
  });
});

// quant (#117): people at risk, a "higher is worse" count.
describe("atRiskTone", () => {
  const t = { goodPct: 80, watchPct: 50 };
  it("is good only when nobody is at risk", () => {
    expect(atRiskTone(0, 88, t)).toBe("good");
    expect(atRiskTone(1, 88, t)).toBe("watch");
  });
  it("a share of 100 - goodPct or more is risk", () => {
    expect(atRiskTone(17, 88, t)).toBe("watch");
    expect(atRiskTone(22, 88, t)).toBe("risk");
  });
});
