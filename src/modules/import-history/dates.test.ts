import { describe, expect, it } from "vitest";
import { parseReportDate } from "./dates";

describe("parseReportDate", () => {
  it("reads ISO dates and timestamps", () => {
    expect(parseReportDate("2023-12-01")).toBe("2023-12-01");
    expect(parseReportDate("2023-12-01T10:00:00Z")).toBe("2023-12-01");
  });

  it("detects day/month order when one part is above 12", () => {
    expect(parseReportDate("12/25/2023")).toBe("2023-12-25");
    expect(parseReportDate("25/12/2023")).toBe("2023-12-25");
  });

  it("uses the profile's format for ambiguous dates, and refuses them without one", () => {
    expect(parseReportDate("03/04/2023", "mdy")).toBe("2023-03-04");
    expect(parseReportDate("03/04/2023", "dmy")).toBe("2023-04-03");
    expect(parseReportDate("03/04/2023")).toBeNull();
  });

  it("refuses what is not a date", () => {
    expect(parseReportDate("someday")).toBeNull();
    expect(parseReportDate("13/13/2023")).toBeNull();
    expect(parseReportDate("2023-02-30")).toBeNull();
    expect(parseReportDate(null)).toBeNull();
  });
});

describe("parseReportPeriod", () => {
  it("reads both ends with a hyphen or an en dash, spaced or not", async () => {
    const { parseReportPeriod } = await import("./dates");
    const want = { start: "2024-03-29", end: "2024-09-28" };
    expect(parseReportPeriod("03/29/2024 - 09/28/2024", "mdy")).toEqual(want);
    expect(parseReportPeriod("03/29/2024–09/28/2024", "mdy")).toEqual(want);
    expect(parseReportPeriod("2024-03-29 – 2024-09-28")).toEqual(want);
    expect(parseReportPeriod("H1 2024")).toBeNull();
  });
});
