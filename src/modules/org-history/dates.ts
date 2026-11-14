/** Time zone that defines "today" for the company (org chart default date). */
export const COMPANY_TIME_ZONE = "America/Argentina/Buenos_Aires";

/** `v` if it is a real YYYY-MM-DD calendar date, else null. */
export function parseIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
    ? v
    : null;
}

/** Today's date (YYYY-MM-DD) in `timeZone`. */
export function todayLocal(
  now: Date = new Date(),
  timeZone: string = COMPANY_TIME_ZONE,
): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const DAY_MS = 86_400_000;

const utcMillis = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/** `iso` (YYYY-MM-DD) plus `days` calendar days; no time zone involved. */
export function addDays(iso: string, days: number): string {
  return new Date(utcMillis(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMillis(to) - utcMillis(from)) / DAY_MS);
}
