import type { CycleDueDates, HireDateSchedule } from "./status";

/**
 * Pure date math of hire-date cycles (no DB, safe to import from client
 * components). Dates are ISO `YYYY-MM-DD` calendar dates, computed in UTC so
 * the server time zone and DST never shift a day.
 */

const DAY_MS = 86_400_000;

/** `iso` plus `days` calendar days (negative to go back). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const windowDays = (s: HireDateSchedule) => s.windowWeeks * 7;

export type HireDateTimeline = {
  /** hire date + milestone days: when the person becomes due. */
  milestoneDate: string;
  /** First day of the window (same day as the milestone). */
  windowStart: string;
  /** Last day of the window: milestone + window weeks. Self and manager share it. */
  dueDate: string;
};

export function hireDateTimeline(
  hireDate: string,
  schedule: HireDateSchedule,
): HireDateTimeline {
  const milestoneDate = addDays(hireDate, schedule.milestoneDays);
  return {
    milestoneDate,
    windowStart: milestoneDate,
    dueDate: addDays(milestoneDate, windowDays(schedule)),
  };
}

/** Own deadlines of someone hired on `hireDate`: self and manager share the window's end. */
export function hireDueDates(
  hireDate: string,
  schedule: HireDateSchedule,
): CycleDueDates {
  const { dueDate } = hireDateTimeline(hireDate, schedule);
  return { self: dueDate, manager: dueDate };
}

/**
 * Hire dates (inclusive) whose milestone falls in [asOf - window, asOf], i.e.
 * whose window is open on `asOf`.
 */
export function enrollmentHireDateRange(
  asOf: string,
  schedule: HireDateSchedule,
): { from: string; to: string } {
  const to = addDays(asOf, -schedule.milestoneDays);
  return { from: addDays(to, -windowDays(schedule)), to };
}

/** Whether someone hired on `hireDate` is due to join the cycle on `asOf`. */
export function isDueForEnrollment(
  hireDate: string,
  asOf: string,
  schedule: HireDateSchedule,
): boolean {
  const { from, to } = enrollmentHireDateRange(asOf, schedule);
  return hireDate >= from && hireDate <= to;
}
