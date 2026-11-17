// Server-free: shared with client components.
export const unmatchedReasons = [
  "missing_fields",
  "invalid_sentiment",
  "unknown_person",
  "unknown_cycle",
  "no_match",
  "ambiguous",
] as const;
export type UnmatchedReason = (typeof unmatchedReasons)[number];
export type UnmatchedRow = {
  /** 1-based data row (the header is row 0). */
  line: number;
  employee: string | null;
  cycle: string | null;
  reason: UnmatchedReason;
};
