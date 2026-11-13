/**
 * Name key for "same person?" comparisons: lowercase, without accents or
 * punctuation, words sorted so "García, Ana" equals "Ana García".
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}
