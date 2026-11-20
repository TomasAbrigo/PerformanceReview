import type { LocalizedText } from "@/db/schema/rating-scales";
import { fold } from "@/modules/qualitative-analysis/dimension";
import { yesNoKindOf } from "@/modules/qualitative-analysis/yes-no-kind";

/** The Santex yes/no questions with a short name of their own (#129). */
export const NAMED_QUESTIONS = [
  "security",
  "conversations",
  "socialImpact",
  "environmentalImpact",
] as const;
export type NamedQuestion = (typeof NAMED_QUESTIONS)[number];

/** Which named question a prompt asks, if any (any language). */
export function namedQuestionOf(prompt: LocalizedText): NamedQuestion | null {
  const kind = yesNoKindOf(prompt);
  if (kind === "security" || kind === "conversations") return kind;
  if (kind !== "impact") return null;
  return /ambient|environment/.test(fold(`${prompt.es} ${prompt.en}`))
    ? "environmentalImpact"
    : "socialImpact";
}

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
    named = {},
  }: {
    /** Short name of each named question (`Qualitative.dimensions`). */
    named?: Partial<Record<NamedQuestion, string>>;
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
      const q = prompts[key] ? namedQuestionOf(prompts[key]) : null;
      return [
        key,
        names[key] ??
          (q ? named[q] : undefined) ??
          prompts[key]?.[locale]?.trim() ??
          (n ? custom(n) : null) ??
          key,
      ];
    }),
  );
}
