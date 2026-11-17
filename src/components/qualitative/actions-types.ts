import type { Sentiment } from "@/modules/qualitative-analysis/constants";
import type { UnmatchedRow } from "@/modules/qualitative-analysis/import-labels-types";

export type Failure = { ok: false; code: string };
export type RunOutcome =
  | {
      ok: true;
      total: number;
      analyzed: number;
      cached: number;
      corrected: number;
      provider: string;
    }
  | Failure;
export type ImportOutcome =
  | { ok: true; total: number; matched: number; unmatched: UnmatchedRow[] }
  | Failure;
export type CorrectOutcome = { ok: true } | Failure;
export type CorrectPayload = {
  sentiment: Sentiment;
  themes: string[];
  reason?: string;
};
