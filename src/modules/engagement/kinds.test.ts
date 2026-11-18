import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUTOFFS,
  engagementSegments,
  monthRange,
  parseEngagementMonth,
  parseEngagementScore,
  parseEngagementSegment,
  segmentOfScore,
  shiftMonth,
} from "./kinds";

describe("parseEngagementMonth", () => {
  it.each([
    ["2026-03", "2026-03-01"],
    ["2026-3", "2026-03-01"],
    ["03/2026", "2026-03-01"],
    ["3/2026", "2026-03-01"],
    ["2026-03-17", "2026-03-01"],
    ["2026-03-01T00:00:00Z", "2026-03-01"],
    [" 2025-12 ", "2025-12-01"],
  ])("reads %s as %s", (text, iso) => {
    expect(parseEngagementMonth(text)).toBe(iso);
  });

  it.each([
    "",
    "2026",
    "13/2026",
    "2026-13",
    "00/2026",
    "marzo 2026",
    "03-2026-01",
  ])("rejects %j", (text) => {
    expect(parseEngagementMonth(text)).toBeNull();
  });
});

describe("parseEngagementScore", () => {
  it.each([
    ["0.73", 0.73],
    ["0,73", 0.73],
    [0.5, 0.5],
    ["0", 0],
    ["1", 1],
    [" .8 ", 0.8],
  ])("reads %j as %s", (raw, score) => {
    expect(parseEngagementScore(raw)).toBe(score);
  });

  it.each(["", "abc", "1.2", "-0.1", "73%", "NaN"])("rejects %j", (raw) => {
    expect(parseEngagementScore(raw)).toBeNull();
  });
});

describe("parseEngagementSegment", () => {
  it.each([
    ["Alto", "alto"],
    ["MEDIO", "medio"],
    [" regular ", "regular"],
    ["Bajo", "bajo"],
    ["Falta", "falta"],
    ["high", "alto"],
    ["Missing", "falta"],
  ])("reads %j as %s", (text, segment) => {
    expect(parseEngagementSegment(text)).toBe(segment);
  });

  it("rejects an unknown label", () => {
    expect(parseEngagementSegment("excelente")).toBeNull();
    expect(parseEngagementSegment("")).toBeNull();
  });

  it("knows the five segments", () => {
    expect(engagementSegments).toEqual([
      "alto",
      "medio",
      "regular",
      "bajo",
      "falta",
    ]);
  });
});

describe("segmentOfScore", () => {
  it("cuts the score at the cutoffs (inclusive from above)", () => {
    expect(DEFAULT_CUTOFFS).toEqual({ alto: 80, medio: 60, regular: 40 });
    expect(segmentOfScore(0.95, DEFAULT_CUTOFFS)).toBe("alto");
    expect(segmentOfScore(0.8, DEFAULT_CUTOFFS)).toBe("alto");
    expect(segmentOfScore(0.79, DEFAULT_CUTOFFS)).toBe("medio");
    expect(segmentOfScore(0.6, DEFAULT_CUTOFFS)).toBe("medio");
    expect(segmentOfScore(0.59, DEFAULT_CUTOFFS)).toBe("regular");
    expect(segmentOfScore(0.4, DEFAULT_CUTOFFS)).toBe("regular");
    expect(segmentOfScore(0.39, DEFAULT_CUTOFFS)).toBe("bajo");
    expect(segmentOfScore(0, DEFAULT_CUTOFFS)).toBe("bajo");
  });

  it("uses other cutoffs when given", () => {
    const cutoffs = { alto: 90, medio: 70, regular: 50 };
    expect(segmentOfScore(0.85, cutoffs)).toBe("medio");
    expect(segmentOfScore(0.5, cutoffs)).toBe("regular");
    expect(segmentOfScore(0.49, cutoffs)).toBe("bajo");
  });

  it("is not thrown off by float noise (0.7 * 100 is 70.00000000000001)", () => {
    expect(segmentOfScore(0.7, { alto: 80, medio: 70, regular: 40 })).toBe(
      "medio",
    );
  });
});

describe("months", () => {
  it("shifts a month, across years", () => {
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2025-12-01", 1)).toBe("2026-01-01");
    expect(shiftMonth("2026-03-01", 0)).toBe("2026-03-01");
  });

  it("lists the months of a range, both ends included", () => {
    expect(monthRange("2025-11-01", "2026-02-01")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
    expect(monthRange("2026-02-01", "2025-11-01")).toEqual([]);
  });
});
