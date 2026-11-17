import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEMESTER_CONFIG,
  periodCycleName,
  periodEndFor,
  semesterOf,
  isSemesterLabel,
  semesterPeriod,
  snapshotDateFor,
  snapToSemester,
} from "./semester";

/** Calendar halves (the examples below); the default is Bamboo's cadence. */
const cfg = { h1Start: "01-01", h2Start: "07-01", ambiguityDays: 15 };

describe("defaults and review periods (#83)", () => {
  it("defaults to Bamboo's cadence: 29/3 and 29/9", () => {
    expect(DEFAULT_SEMESTER_CONFIG).toMatchObject({
      h1Start: "03-29",
      h2Start: "09-29",
    });
  });

  it("ends a period the day before the next cutoff after its start", () => {
    const real = DEFAULT_SEMESTER_CONFIG;
    expect(periodEndFor("2024-03-29", real)).toBe("2024-09-28");
    expect(periodEndFor("2024-09-29", real)).toBe("2025-03-28");
    // Irregular historical starts.
    expect(periodEndFor("2023-04-17", real)).toBe("2023-09-28");
    expect(periodEndFor("2023-10-02", real)).toBe("2024-03-28");
    expect(periodEndFor("2024-01-10", real)).toBe("2024-03-28");
  });

  it("names the cycle by its period", () => {
    expect(periodCycleName("2024-03-29", "2024-09-28")).toBe(
      "Evaluación semestral 2024-03-29 – 2024-09-28",
    );
  });
});

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

describe("isSemesterLabel / snapshotDateFor", () => {
  it("tells bare semester labels from named cycles", () => {
    expect(isSemesterLabel("2025-H1")).toBe(true);
    expect(isSemesterLabel("Evaluación semestral 2025-H1")).toBe(false);
    expect(isSemesterLabel(null)).toBe(false);
  });

  it("never takes a snapshot as of a future date", () => {
    expect(snapshotDateFor("2025-06-30", "2026-11-17")).toBe("2025-06-30");
    expect(snapshotDateFor("2026-12-31", "2026-11-17")).toBe("2026-11-17");
  });
});
