/**
 * The words of a name, in the order they were written, lowercase and without
 * accents or punctuation: "  María   JOSÉ López" is ["maria", "jose", "lopez"].
 */
export function nameWords(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * Name key that respects the order of the words: "María José López" and
 * "José María López" are different people. For matching names that are
 * written in the same order; accents, case and spacing do not matter.
 */
export function orderedName(name: string): string {
  return nameWords(name).join(" ");
}

/**
 * Name key for "same person?" comparisons: lowercase, without accents or
 * punctuation, words sorted so "García, Ana" equals "Ana García". Loose on
 * purpose (so does "José María López" equal "María José López"): a hit is a
 * candidate, not a certainty.
 */
export function normalizeName(name: string): string {
  return nameWords(name).sort().join(" ");
}
