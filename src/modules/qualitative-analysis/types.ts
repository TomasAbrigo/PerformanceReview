// Drizzle- and server-free: shared by the queries and client components.
import type { LocalizedText } from "@/db/schema/rating-scales";
import type { OrgFilters } from "@/modules/org-attributes/kinds";
import { sentiments, type Sentiment } from "./constants";

export type QualitativeFilters = OrgFilters & {
  cycleId?: string;
  department?: string;
  dimension?: string;
  sentiment?: Sentiment;
  theme?: string;
  /** Only the answers of reviews of this relationship (self, manager...). */
  relationship?: "self" | "manager" | "peer" | "upward";
  /**
   * Count the labels of closed-question answers too; the
   * `analysis.includeClosed` setting when the caller did not read it.
   */
  includeClosed?: boolean;
  /**
   * The `aggregation.minGroupSize` setting when the caller already read it
   * (one read per request); read from the settings otherwise.
   */
  minGroupSize?: number;
  /** Leadership view: counts only, no comments, quotes or names. */
  aggregateOnly?: boolean;
};

export type SentimentCounts = Record<Sentiment, number> & { total: number };

/** The counts of a row (whatever else it carries: a dimension, a theme...). */
export function pickCounts(
  row: Record<Sentiment, number> & { total: number },
): SentimentCounts {
  return {
    ...(Object.fromEntries(sentiments.map((s) => [s, row[s]])) as Record<
      Sentiment,
      number
    >),
    total: row.total,
  };
}

export type DimensionSentiment = SentimentCounts & { dimension: string };

/** The sentiment of one participant's comments in their cycle. */
export type ParticipantSentiment = SentimentCounts & {
  participantId: string;
};

/** What the comments can be cut by besides their dimension: area or an org attribute. */
export const qualitativeGroupBys = [
  "department",
  "account",
  "project",
  "dm",
  "santex_lead",
] as const;
export type QualitativeGroupBy = (typeof qualitativeGroupBys)[number];

/** Sentiment of the comments of a group of people (`participants` of them). */
export type GroupSentiment = SentimentCounts & {
  /** The area or attribute value; for direction, a DM / Santex Lead has an opaque key. Null: no value. */
  key: string | null;
  label: string | null;
  participants: number;
};
export type TrendPoint = SentimentCounts & {
  cycleId: string;
  cycleName: string;
  periodEnd: string;
};
export type ThemeRank = {
  theme: string;
  count: number;
  /** Sentiment of the comments of the theme (its total is `count`). */
  sentiment: SentimentCounts;
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
  /** Review period of the cycle (ISO dates). */
  periodStart: string;
  periodEnd: string;
  personName: string;
  relationship: string;
  dimension: string;
  text: string;
  sentiment: Sentiment;
  themes: string[];
  confidence: number | null;
  source: string;
};

/** What the filters offer. */
export type QualitativeFilterOptions = {
  dimensions: string[];
  themes: string[];
  departments: string[];
  /** Prompt of the latest question of each dimension (the label of dimensions without a name of their own). */
  dimensionPrompts: Record<string, LocalizedText>;
};
