/** ISO calendar-date helpers (YYYY-MM-DD, UTC). ISO dates sort as strings. */
const DAY_MS = 86_400_000;

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  return new Date(toMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

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
