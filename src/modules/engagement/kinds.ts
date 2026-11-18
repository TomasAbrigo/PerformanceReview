// Drizzle- and server-free: shared by the schema, the import, the queries and
// the client components (docs/engagement-monthly.md).

/**
 * The segments of a monthly engagement score. `falta` is a person who did
 * not answer that month (no score); the other four are cuts of the score.
 */
export const engagementSegments = [
  "alto",
  "medio",
  "regular",
  "bajo",
  "falta",
] as const;
export type EngagementSegment = (typeof engagementSegments)[number];

/** The segments a score falls in, best first (`falta` has none). */
export const scoredSegments = [
  "alto",
  "medio",
  "regular",
  "bajo",
] as const satisfies readonly EngagementSegment[];

/**
 * Where a score becomes `alto`, `medio` and `regular`, in percent of the 0-1
 * score (the settings `engagement.cutoff*`): from `alto` up is alto, from
 * `medio` up medio, from `regular` up regular, below it bajo.
 */
export type EngagementCutoffs = {
  alto: number;
  medio: number;
  regular: number;
};
export const DEFAULT_CUTOFFS: EngagementCutoffs = {
  alto: 80,
  medio: 60,
  regular: 40,
};

/** The segment of a 0-1 score for the cutoffs (never `falta`). */
export function segmentOfScore(
  score: number,
  cutoffs: EngagementCutoffs,
): Exclude<EngagementSegment, "falta"> {
  // Rounded: 0.7 * 100 is 70.00000000000001, which must not cross a cutoff.
  const percent = Math.round(score * 1e8) / 1e6;
  if (percent >= cutoffs.alto) return "alto";
  if (percent >= cutoffs.medio) return "medio";
  if (percent >= cutoffs.regular) return "regular";
  return "bajo";
}

const pad = (n: number) => String(n).padStart(2, "0");
const validMonth = (year: number, month: number) =>
  Number.isInteger(year) &&
  year >= 1900 &&
  year <= 2200 &&
  month >= 1 &&
  month <= 12;

/**
 * The first day (ISO) of the month a cell names: `YYYY-MM`, `MM/YYYY`, or a
 * full date (`YYYY-MM-DD`, with or without a time) whose day is dropped. null
 * for anything else, including a bare year or a month out of 1-12.
 */
export function parseEngagementMonth(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  let match = /^(\d{4})-(\d{1,2})(?:-\d{1,2}(?:[T ].*)?)?$/.exec(text);
  if (match && validMonth(Number(match[1]), Number(match[2]))) {
    return `${match[1]}-${pad(Number(match[2]))}-01`;
  }
  match = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (match && validMonth(Number(match[2]), Number(match[1]))) {
    return `${match[2]}-${pad(Number(match[1]))}-01`;
  }
  return null;
}

/**
 * A score of 0-1 ("0.73" or, as a Spanish sheet writes it, "0,73"); null for
 * anything else: empty, not a number, out of 0-1, or a percentage sign.
 */
export function parseEngagementScore(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null;
  }
  const text = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const score = Number(text);
  return score >= 0 && score <= 1 ? score : null;
}

const SEGMENT_LABELS: Record<string, EngagementSegment> = {
  alto: "alto",
  high: "alto",
  medio: "medio",
  medium: "medio",
  regular: "regular",
  bajo: "bajo",
  low: "bajo",
  falta: "falta",
  missing: "falta",
};

/** The segment a label names (Spanish, or the English one), any case; null if unknown. */
export function parseEngagementSegment(raw: unknown): EngagementSegment | null {
  return (
    SEGMENT_LABELS[
      String(raw ?? "")
        .trim()
        .toLowerCase()
    ] ?? null
  );
}

/** `month` (a first of month, ISO) moved by `by` months. */
export function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

/** Every month from `from` to `to` (firsts of month, ISO), both included. */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) months.push(m);
  return months;
}
