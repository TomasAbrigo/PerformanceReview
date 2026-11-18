// Drizzle- and server-free: shared by the queries and client components.
import type { Sentiment } from "@/modules/qualitative-analysis/constants";

/**
 * Whose people a DM card counts: `direct`, those whose DM attribute (the org
 * attributes file) is that DM; `tree`, also everybody below the DM in the
 * organization chart of the cycle snapshot (when the DM resolves to a person).
 */
export const dm360Scopes = ["direct", "tree"] as const;
export type Dm360Scope = (typeof dm360Scopes)[number];

/** The mean of a 1-5 indicator and how many people it is over. */
export type Mean = { mean: number; n: number };

export type SentimentShare = {
  /** Comments counted (open text, effective labels). */
  comments: number;
  /** People who wrote at least one. */
  people: number;
  counts: Record<Sentiment, number>;
  /** counts / comments, 0-1. */
  share: Record<Sentiment, number>;
};

/** One cycle of the sparkline of a card; null where there is nothing to show. */
export type Dm360Point = {
  cycleId: string;
  cycleName: string;
  periodStart: string;
  /** People of the card in the cycle; null when direction cannot see it. */
  people: number | null;
  retention: number | null;
  engagement: number | null;
};

/**
 * A sentence of the card, decided by rules and written from a message key
 * (`Insights360.insight.<code>`) with these numbers: no model involved.
 */
export type Insight360 =
  | {
      code: "retentionDrop" | "engagementDrop";
      /** Mean of the previous cycle with one, the mean now, and the fall (one decimal). */
      params: {
        previous: number;
        current: number;
        delta: number;
        cycle: string;
      };
    }
  | { code: "negativeSentiment"; params: { percent: number; comments: number } }
  | { code: "riskHigh"; params: { percent: number; people: number } }
  | { code: "completionLow"; params: { percent: number } }
  | { code: "stable" }
  | { code: "noData" };

export type Dm360Card = {
  /** The DM as the file wrote them; for direction an opaque key. */
  key: string;
  /** The DM's name; null for direction (a team, never a name) and for "Otros". */
  label: string | null;
  /** The people of the DMs under the minimum, together (direction). */
  others: boolean;
  /** Everybody in the card, in the cycle. */
  people: number;
  retention: Mean | null;
  engagement: Mean | null;
  /** People with both indicators at or under the risk threshold, over those with both. */
  risk: { people: number; of: number; share: number } | null;
  sentiment: SentimentShare | null;
  /** Submitted / applicable, 0-1; null when it applies to nobody (or direction cannot see it). */
  selfRate: number | null;
  managerRate: number | null;
  /** The cycles up to the one asked for, oldest first. */
  trend: Dm360Point[];
  insights: Insight360[];
};

export type Dm360Thresholds = {
  /** Fall of a mean (points) that is an alert: the `alerts.dropThreshold` setting. */
  dropThreshold: number;
  /** At or under it on both indicators is a risk: the `alerts.riskThreshold` setting. */
  riskThreshold: number;
};

export type Dm360 = {
  cycleId: string;
  cycleName: string;
  scope: Dm360Scope;
  /** Direction's minimum group size; null when nothing is masked. */
  minGroupSize: number | null;
  thresholds: Dm360Thresholds;
  /** Cards of the DMs in the cycle (direction: those of at least the minimum, plus "Otros"). */
  cards: Dm360Card[];
  /** People of the cycle with no DM in the file (not in any card); null for direction. */
  withoutDm: number | null;
  /** People left out of every card (direction: groups under the minimum, even together). */
  suppressed: number;
};

/** A negative share at or above this is worth saying (with at least `MIN_COMMENTS`). */
export const NEGATIVE_SHARE_ALERT = 0.3;
/** Comments needed before a sentiment share is an insight. */
export const MIN_COMMENTS = 3;
/** A share of people at risk at or above this, over at least `MIN_RISK_PEOPLE`, is an insight. */
export const RISK_SHARE_ALERT = 0.25;
export const MIN_RISK_PEOPLE = 3;
/** A manager-assessment completion under this is worth saying. */
export const COMPLETION_ALERT = 0.5;
/** Points of the sparkline: the latest cycles up to the one asked for. */
export const SPARK_CYCLES = 8;
