/** ISO calendar-date helpers (YYYY-MM-DD, UTC). ISO dates sort as strings. */
import { addDays, daysBetween } from "../../modules/org-history/dates";

export { addDays, daysBetween };

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Uniformly random calendar date in [from, to]. */
export function dateBetween(
  from: string,
  to: string,
  random: (min: number, max: number) => number,
): string {
  return addDays(from, random(0, Math.max(0, daysBetween(from, to))));
}
