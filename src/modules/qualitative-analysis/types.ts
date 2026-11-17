// Drizzle- and server-free: shared by the queries and client components.
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { Sentiment } from "./constants";

export type QualitativeFilters = {
  cycleId?: string;
  department?: string;
  dimension?: string;
  sentiment?: Sentiment;
  theme?: string;
  /** Leadership view: counts only, no comments, quotes or names. */
  aggregateOnly?: boolean;
};

export type SentimentCounts = Record<Sentiment, number> & { total: number };

export type DimensionSentiment = SentimentCounts & { dimension: string };
export type TrendPoint = SentimentCounts & {
  cycleId: string;
  cycleName: string;
  periodEnd: string;
};
export type ThemeRank = {
  theme: string;
  count: number;
  /** 2-3 example quotes with names, emails and legajos replaced. */
  quotes: string[];
};
export type IndicatorSentiment = SentimentCounts & {
  role: string;
  option: string;
  label: LocalizedText | null;
};
export type CommentRow = {
  answerId: string;
  cycleName: string;
  personName: string;
  relationship: string;
  dimension: string;
  text: string;
  sentiment: Sentiment;
  themes: string[];
  confidence: number | null;
  source: string;
};
