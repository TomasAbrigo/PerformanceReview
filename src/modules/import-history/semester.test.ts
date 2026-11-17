import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEMESTER_CONFIG,
  semesterOf,
  semesterPeriod,
  snapToSemester,
} from "./semester";

const cfg = DEFAULT_SEMESTER_CONFIG;

describe("semesterOf", () => {
  it("puts a date in the first or second half by the configured cutoffs", () => {
    expect(semesterOf("2025-03-10", cfg)).toEqual({
      year: 2025,
      half: 1,
      label: "2025-H1",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
      ambiguous: false,
    });
    expect(semesterOf("2025-10-02", cfg)).toMatchObject({
      label: "2025-H2",
      periodStart: "2025-07-01",
      periodEnd: "2025-12-31",
      ambiguous: false,
    });
  });

  it("is ambiguous within ambiguityDays of a cutoff, on either side", () => {
    expect(semesterOf("2025-06-25", cfg).ambiguous).toBe(true);
    expect(semesterOf("2025-07-03", cfg).ambiguous).toBe(true);
    expect(semesterOf("2025-12-28", cfg).ambiguous).toBe(true);
    expect(semesterOf("2026-01-05", cfg)).toMatchObject({
      label: "2026-H1",
      ambiguous: true,
    });
    expect(semesterOf("2025-06-10", cfg).ambiguous).toBe(false);
  });

  it("follows custom cutoffs: a fiscal year starting in April", () => {
    const fiscal = { h1Start: "04-01", h2Start: "10-01", ambiguityDays: 0 };
    expect(semesterOf("2025-02-15", fiscal)).toMatchObject({
      label: "2024-H2",
      periodStart: "2024-10-01",
      periodEnd: "2025-03-31",
    });
    expect(semesterOf("2025-04-01", fiscal)).toMatchObject({
      label: "2025-H1",
      periodStart: "2025-04-01",
      periodEnd: "2025-09-30",
    });
  });
});

describe("semesterPeriod / snapToSemester", () => {
  it("gives the bounds of a label", () => {
    expect(semesterPeriod("2024-H2", cfg)).toEqual({
      periodStart: "2024-07-01",
      periodEnd: "2024-12-31",
    });
    expect(semesterPeriod("Ciclo 2024", cfg)).toBeNull();
  });

  it("snaps a period to its semester only when both ends are in it", () => {
    expect(
      snapToSemester(
        { periodStart: "2024-11-27", periodEnd: "2024-12-15" },
        cfg,
      ),
    ).toEqual({ periodStart: "2024-07-01", periodEnd: "2024-12-31" });
    expect(
      snapToSemester(
        { periodStart: "2024-12-01", periodEnd: "2025-01-20" },
        cfg,
      ),
    ).toBeNull();
  });
});
