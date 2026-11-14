const DAY_MS = 24 * 60 * 60 * 1000;

const utcMillis = (iso: string): number => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** `iso` (YYYY-MM-DD) plus `days` calendar days; no time zone involved. */
export function addDays(iso: string, days: number): string {
  return new Date(utcMillis(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMillis(to) - utcMillis(from)) / DAY_MS);
}
