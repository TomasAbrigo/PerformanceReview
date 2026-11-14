import { describe, expect, it } from "vitest";
import {
  addDays,
  enrollmentHireDateRange,
  hireDateTimeline,
  isDueForEnrollment,
} from "./hire-date-schedule";
import type { HireDateSchedule } from "./status";

const days = (milestoneDays: HireDateSchedule["milestoneDays"]) =>
  ({ milestoneDays, windowWeeks: 1 }) satisfies HireDateSchedule;

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("adds 30 days to Jan 31 (Feb has 28 or 29 days)", () => {
    expect(addDays("2025-01-31", 30)).toBe("2025-03-02");
    expect(addDays("2024-01-31", 30)).toBe("2024-03-01");
  });

  it("handles leap years", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    // 1900 is not a leap year, 2000 is.
    expect(addDays("1900-02-28", 1)).toBe("1900-03-01");
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29");
  });

  it("leaves a date alone with 0 days", () => {
    expect(addDays("2026-05-17", 0)).toBe("2026-05-17");
  });
});

describe("hireDateTimeline", () => {
  it("opens the window at the milestone and closes it windowWeeks later", () => {
    expect(
      hireDateTimeline("2026-01-31", { milestoneDays: 30, windowWeeks: 2 }),
    ).toEqual({
      milestoneDate: "2026-03-02",
      windowStart: "2026-03-02",
      dueDate: "2026-03-16",
    });
  });

  it("covers every milestone and window length, incl. leap years", () => {
    // Hired on a leap day: 365 days later is Feb 28 of the next year.
    expect(
      hireDateTimeline("2024-02-29", { milestoneDays: 365, windowWeeks: 4 }),
    ).toMatchObject({ milestoneDate: "2025-02-28", dueDate: "2025-03-28" });
    // Hired on Mar 1 2023: 365 days later falls on the leap day 2024-02-29.
    expect(
      hireDateTimeline("2023-03-01", { milestoneDays: 365, windowWeeks: 1 }),
    ).toMatchObject({ milestoneDate: "2024-02-29", dueDate: "2024-03-07" });
    expect(
      hireDateTimeline("2025-11-15", { milestoneDays: 180, windowWeeks: 3 }),
    ).toMatchObject({ milestoneDate: "2026-05-14", dueDate: "2026-06-04" });
    expect(hireDateTimeline("2025-12-20", days(90))).toMatchObject({
      milestoneDate: "2026-03-20",
      dueDate: "2026-03-27",
    });
    expect(hireDateTimeline("2025-12-31", days(60))).toMatchObject({
      milestoneDate: "2026-03-01",
      dueDate: "2026-03-08",
    });
  });
});

describe("isDueForEnrollment", () => {
  const schedule = { milestoneDays: 30, windowWeeks: 2 } as const;

  it("includes the whole [asOf - window, asOf] range, both ends inclusive", () => {
    // Milestone date of a Jan 31 hire: Mar 2 2025.
    expect(isDueForEnrollment("2025-01-31", "2025-03-02", schedule)).toBe(true);
    expect(isDueForEnrollment("2025-01-31", "2025-03-16", schedule)).toBe(true);
    expect(isDueForEnrollment("2025-01-31", "2025-03-09", schedule)).toBe(true);
  });

  it("excludes milestones in the future or already out of the window", () => {
    expect(isDueForEnrollment("2025-01-31", "2025-03-01", schedule)).toBe(
      false,
    );
    expect(isDueForEnrollment("2025-01-31", "2025-03-17", schedule)).toBe(
      false,
    );
  });

  it("respects the month boundary in leap and non-leap years", () => {
    // Hired 2024-01-31: milestone is Mar 1 in a leap year, Mar 2 otherwise.
    expect(isDueForEnrollment("2024-01-31", "2024-03-01", schedule)).toBe(true);
    expect(isDueForEnrollment("2024-01-31", "2024-02-29", schedule)).toBe(
      false,
    );
    expect(isDueForEnrollment("2025-01-31", "2025-03-01", schedule)).toBe(
      false,
    );
  });
});

describe("enrollmentHireDateRange", () => {
  it("is the exact inverse of isDueForEnrollment", () => {
    const schedule = { milestoneDays: 90, windowWeeks: 3 } as const;
    const asOf = "2026-03-10";
    const { from, to } = enrollmentHireDateRange(asOf, schedule);
    expect(isDueForEnrollment(from, asOf, schedule)).toBe(true);
    expect(isDueForEnrollment(to, asOf, schedule)).toBe(true);
    expect(isDueForEnrollment(addDays(from, -1), asOf, schedule)).toBe(false);
    expect(isDueForEnrollment(addDays(to, 1), asOf, schedule)).toBe(false);
  });

  it("gives the hire dates whose milestone falls in the window", () => {
    expect(
      enrollmentHireDateRange("2026-03-10", {
        milestoneDays: 30,
        windowWeeks: 1,
      }),
    ).toEqual({ from: "2026-02-01", to: "2026-02-08" });
  });
});
