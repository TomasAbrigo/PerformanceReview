import type { LocalizedText } from "@/db/schema";

const DAY = String.raw`(\d{4})-(\d{2})-(\d{2})`;
const PERIOD = new RegExp(`${DAY} – ${DAY}`);

/**
 * A period written as two ISO days ("2026-03-29 – 2026-09-28", what the
 * names of the imported period cycles carry) reads as its months: "mar –
 * sept 2026", or "sept 2025 – mar 2026" when it crosses a year. The stored
 * name keeps the days; this is only how the screens show it (#119).
 */
function readablePeriod(name: string, locale: string): string {
  return name.replace(PERIOD, (match, y1, m1, d1, y2, m2, d2) => {
    const start = Date.UTC(Number(y1), Number(m1) - 1, Number(d1));
    const end = Date.UTC(Number(y2), Number(m2) - 1, Number(d2));
    const real = (time: number, m: string, d: string) =>
      new Date(time).getUTCMonth() === Number(m) - 1 &&
      new Date(time).getUTCDate() === Number(d);
    if (!real(start, m1, d1) || !real(end, m2, d2)) return match;
    const month = new Intl.DateTimeFormat(locale === "en" ? "en" : "es", {
      month: "short",
      timeZone: "UTC",
    });
    const from = month.format(start).replace(".", "");
    const to = month.format(end).replace(".", "");
    return y1 === y2 ? `${from} – ${to} ${y2}` : `${from} ${y1} – ${to} ${y2}`;
  });
}

/**
 * A cycle's name in `locale` as it is stored: its localized one when
 * generated (#83), the days of its period as ISO days. For files (the CSV
 * exports), where the name is data.
 */
export function storedCycleName(
  cycle: { name: string; localizedName?: LocalizedText | null },
  locale: string,
): string {
  const localized = cycle.localizedName;
  if (!localized) return cycle.name;
  return (locale === "en" ? localized.en : localized.es) || cycle.name;
}

/**
 * A cycle's name in `locale` as the screens show it: the stored one, with
 * a period of ISO days written as months.
 */
export function cycleName(
  cycle: { name: string; localizedName?: LocalizedText | null },
  locale: string,
): string {
  return readablePeriod(storedCycleName(cycle, locale), locale);
}

/** The cycles with `name` in `locale` (pages show `name`). */
export function localizeCycles<
  T extends { name: string; localizedName?: LocalizedText | null },
>(cycles: T[], locale: string): T[] {
  return cycles.map((c) => ({ ...c, name: cycleName(c, locale) }));
}
