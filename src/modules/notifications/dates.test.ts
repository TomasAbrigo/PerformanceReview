import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "./dates";

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
