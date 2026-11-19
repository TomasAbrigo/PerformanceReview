// Drizzle- and server-free: shared by the queries and client components.
import type { LocalizedText } from "@/db/schema/rating-scales";

export type Choice = { value: string; label: LocalizedText };

/**
 * The choice of a closed scale question that stands for `value` (1..n): the
 * choice whose value is that number, else, for the letter choices Bamboo's
 * questions carry (A = best .. E = worst), the one at position n − value.
 * Null when the value is outside the scale. The label is the translated
 * text of the question, never the answer's raw `option_label` (which, in a
 * report export, can carry the person's name).
 */
export function choiceOfValue(
  choices: readonly Choice[] | null | undefined,
  value: number,
): Choice | null {
  if (!choices?.length || !Number.isInteger(value)) return null;
  const exact = choices.find((c) => c.value === String(value));
  if (exact) return exact;
  if (value < 1 || value > choices.length) return null;
  return choices[choices.length - value] ?? null;
}
