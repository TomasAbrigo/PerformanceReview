import type { LocalizedText } from "@/db/schema/rating-scales";
import type { Sentiment, Signal, Substance, YesNo } from "./constants";

/**
 * Which rubric a text is read with (#128), from its question:
 * - `strengths`: what the person does well (themes: the strength).
 * - `improvement`: what to improve (only praise there is substance none).
 * - `yes_no_detail`: the "how" after the yes/no of a yes/no question; for
 *   the social / environmental impact questions the themes are initiative
 *   types (IMPACT_THEMES).
 * - `open`: any other free text (best work "Other: …", custom questions).
 */
export const rubrics = [
  "strengths",
  "improvement",
  "yes_no_detail",
  "open",
] as const;
export type Rubric = (typeof rubrics)[number];

/** Who writes about whom: a self review, or a manager about a report. */
export type Writer = "self" | "manager" | "peer" | "upward";

/**
 * One text to read. `token` identifies it in the batch (not content); the
 * text is already pseudonymized.
 */
export type AnalysisInput = {
  token: string;
  dimension: string;
  rubric: Rubric;
  /** The question as asked (es/en). */
  question: LocalizedText;
  /** Who answers about whom. */
  relationship: Writer;
  /** The yes/no already resolved, for a yes/no question; else null. */
  yesNo: YesNo | null;
  text: string;
};

/** The reading of one answer (#128). */
export type AnalysisOutput = {
  token: string;
  /** Whether it answers what was asked. */
  substance: Substance;
  /** Up to 3 normalized theme keys (THEMES, IMPACT_THEMES, or a new one). */
  themes: string[];
  /** What People has to attend to (keys of `signals`). */
  signals: Signal[];
  /** The tone, a secondary reading. */
  sentiment: Sentiment;
  /** 0..1, or null when the provider does not estimate it (mock). */
  confidence: number | null;
};

/**
 * Reads open-text answers. Inputs are already pseudonymized; an
 * implementation must never log their text.
 */
export interface AnalysisProvider {
  readonly name: string;
  readonly promptVersion: string;
  readonly model?: string;
  /** Texts per analyze() call the service should send (default: all). */
  readonly batchSize?: number;
  analyze(
    batch: AnalysisInput[],
    signal?: AbortSignal,
  ): Promise<AnalysisOutput[]>;
}
