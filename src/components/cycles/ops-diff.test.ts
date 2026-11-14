import { describe, expect, it } from "vitest";
import { diffSnapshots, formatDiffValue } from "./ops-diff";

describe("diffSnapshots", () => {
  it("lists only the fields that changed", () => {
    expect(
      diffSnapshots(
        { phase: "manager", date: "2022-07-30" },
        { phase: "manager", date: "2022-08-15" },
      ),
    ).toEqual([{ path: "date", before: "2022-07-30", after: "2022-08-15" }]);
  });

  it("shows everything as added when there was no before (and removed with no after)", () => {
    expect(diffSnapshots(null, { personId: "p1", removedAt: null })).toEqual([
      { path: "personId", before: undefined, after: "p1" },
      { path: "removedAt", before: undefined, after: null },
    ]);
    expect(diffSnapshots({ a: 1 }, null)).toEqual([
      { path: "a", before: 1, after: undefined },
    ]);
  });

  it("flattens nested objects with dotted paths and compares arrays whole", () => {
    expect(
      diffSnapshots(
        { answers: { q1: "a", q2: "same" }, assessorIds: ["x"] },
        {
          answers: { q1: "b", q2: "same", q3: "new" },
          assessorIds: ["x", "y"],
        },
      ),
    ).toEqual([
      { path: "answers.q1", before: "a", after: "b" },
      { path: "answers.q3", before: undefined, after: "new" },
      { path: "assessorIds", before: ["x"], after: ["x", "y"] },
    ]);
  });

  it("returns nothing when both sides are equal or empty", () => {
    expect(diffSnapshots({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffSnapshots(null, null)).toEqual([]);
  });
});

describe("formatDiffValue", () => {
  it("renders missing and null as a dash and structures as JSON", () => {
    expect(formatDiffValue(undefined)).toBe("—");
    expect(formatDiffValue(null)).toBe("—");
    expect(formatDiffValue("texto")).toBe("texto");
    expect(formatDiffValue(3)).toBe("3");
    expect(formatDiffValue(false)).toBe("false");
    expect(formatDiffValue(["a", "b"])).toBe('["a","b"]');
  });
});
