import { describe, expect, it } from "vitest";
import { addDays, daysBetween, parseIsoDate, todayLocal } from "./dates";

describe("parseIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(parseIsoDate("2024-02-29")).toBe("2024-02-29");
    expect(parseIsoDate("2023-12-31")).toBe("2023-12-31");
  });

  it("rejects impossible or malformed dates", () => {
    for (const v of [
      "2023-02-29",
      "2023-02-31",
      "2023-13-01",
      "2023-00-10",
      "2023-1-1",
      "x",
      undefined,
      ["2023-01-01"],
    ]) {
      expect(parseIsoDate(v)).toBeNull();
    }
  });
});

describe("todayLocal", () => {
  it("uses the company time zone, not UTC", () => {
    // 01:30 UTC on Jan 2 is still Jan 1 in Buenos Aires (UTC-3).
    const now = new Date("2026-01-02T01:30:00Z");
    expect(todayLocal(now)).toBe("2026-01-01");
    expect(todayLocal(now, "UTC")).toBe("2026-01-02");
  });
});

describe("addDays", () => {
  it.each([
    ["2026-07-08", 7, "2026-07-15"],
    ["2026-07-14", 1, "2026-07-15"],
    ["2026-07-15", 0, "2026-07-15"],
    ["2026-12-30", 7, "2027-01-06"],
    ["2028-02-25", 7, "2028-03-03"],
    ["2026-03-01", -1, "2026-02-28"],
  ])("%s + %d days = %s", (iso, days, expected) => {
    expect(addDays(iso, days)).toBe(expected);
  });
});

describe("daysBetween", () => {
  it("counts calendar days from `from` to `to` (negative when past)", () => {
    expect(daysBetween("2026-07-08", "2026-07-15")).toBe(7);
    expect(daysBetween("2026-07-15", "2026-07-15")).toBe(0);
    expect(daysBetween("2026-07-16", "2026-07-15")).toBe(-1);
    expect(daysBetween("2026-12-30", "2027-01-06")).toBe(7);
  });
});
