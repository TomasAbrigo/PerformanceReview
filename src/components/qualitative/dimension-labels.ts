import type { LocalizedText } from "@/db/schema/rating-scales";

/** The dimension keys that have a message (`Qualitative.dimensions`). */
export const KNOWN_DIMENSIONS = [
  "strengths",
  "improvement",
  "valued",
  "best_work",
  "other",
] as const;

/**
 * Display label of each dimension key. The dimensions come from the data
 * (question_revision.dimension), so any key can show up: a known key has its
 * message; `custom_<n>` and an unknown key show the prompt of their latest
 * question, `custom_<n>` without one a pattern, and the rest the key itself.
 */
export function dimensionLabels(
  keys: string[],
  {
    names,
    custom,
    prompts,
    locale,
  }: {
    /** Message per known key (`Qualitative.dimensions`). */
    names: Record<string, string>;
    /** Label of `custom_<n>`, given n. */
    custom: (n: string) => string;
    prompts: Record<string, LocalizedText>;
    locale: "es" | "en";
  },
): Record<string, string> {
  return Object.fromEntries(
    keys.map((key) => {
      const n = /^custom_(\d+)$/.exec(key)?.[1];
      return [
        key,
        names[key] ??
          prompts[key]?.[locale]?.trim() ??
          (n ? custom(n) : null) ??
          key,
      ];
    }),
  );
}
