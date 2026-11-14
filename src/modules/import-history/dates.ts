/** How a profile's report writes day/month dates ("12/25/2023"). */
export type DateFormat = "mdy" | "dmy";

const valid = (y: number, m: number, d: number): string | null => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};

/**
 * An ISO date out of a report cell. ISO dates (and timestamps) always work;
 * "a/b/yyyy" is read day-first or month-first when one part is above 12, and
 * otherwise as the profile's `dateFormat` says. Anything else is null, so the
 * row is rejected with a clear reason instead of guessed.
 */
export function parseReportDate(
  value: unknown,
  format?: DateFormat,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (!slash) return null;
  const [a, b, y] = [Number(slash[1]), Number(slash[2]), Number(slash[3])];
  const order: DateFormat | undefined =
    a > 12 && b <= 12 ? "dmy" : b > 12 && a <= 12 ? "mdy" : format;
  if (!order) return null;
  return order === "mdy" ? valid(y, a, b) : valid(y, b, a);
}
