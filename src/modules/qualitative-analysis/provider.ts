import type { Sentiment } from "./constants";

/**
 * One text to analyze. `token` identifies it in the batch (not content).
 * `closed`: the text is the label of a closed-question answer (a chosen
 * option), not free text.
 */
export type AnalysisInput = {
  token: string;
  dimension: string;
  text: string;
  closed?: boolean;
};
export type AnalysisOutput = {
  token: string;
  sentiment: Sentiment;
  confidence: number;
  themes: string[];
};

/**
 * Labels open-text answers. Inputs are already pseudonymized; an
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
