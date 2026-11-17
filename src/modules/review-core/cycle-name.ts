import type { LocalizedText } from "@/db/schema";

/** A cycle's name in `locale`: its localized one when generated (#83). */
export function cycleName(
  cycle: { name: string; localizedName?: LocalizedText | null },
  locale: string,
): string {
  const localized = cycle.localizedName;
  if (!localized) return cycle.name;
  return (locale === "en" ? localized.en : localized.es) || cycle.name;
}

/** The cycles with `name` in `locale` (pages show `name`). */
export function localizeCycles<
  T extends { name: string; localizedName?: LocalizedText | null },
>(cycles: T[], locale: string): T[] {
  return cycles.map((c) => ({ ...c, name: cycleName(c, locale) }));
}
