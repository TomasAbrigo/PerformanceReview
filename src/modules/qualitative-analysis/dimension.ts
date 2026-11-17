import type { LocalizedText } from "@/db/schema/rating-scales";

/**
 * Dimension of an open-text question: question_revision.dimension (#57) when
 * set, else a stable key derived from the prompt (revisions copied before the
 * column existed, or questions without one).
 */
export function dimensionOf(q: {
  prompt: LocalizedText;
  dimension?: string | null;
}): string {
  if (q.dimension) return q.dimension;
  const text = fold(`${q.prompt.es} ${q.prompt.en}`);
  if (/\b(do|does) well\b|\bhago bien\b|\bhace bien\b|\bfortaleza/.test(text)) {
    return "strengths";
  }
  if (/\bimprove\b|\bmejorar\b/.test(text)) return "improvement";
  const custom = /custom q?(\d+)/.exec(text);
  if (custom) return `custom_${custom[1]}`;
  return "other";
}

/** Lowercase, without accents. */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
