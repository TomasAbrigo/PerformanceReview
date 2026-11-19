import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { selfManagerGap } from "@/modules/analytics/dashboards/queries";
import { ALL_PEOPLE } from "@/modules/analytics/dashboards/scope";
import type { GapByQuestion } from "@/modules/analytics/dashboards/types";
import {
  sentimentByDimension,
  topThemes,
} from "@/modules/qualitative-analysis/queries";
import {
  type DimensionSentiment,
  pickCounts,
  type SentimentCounts,
  type ThemeRank,
} from "@/modules/qualitative-analysis/types";
import {
  agreementBySide,
  bestWorkOptions,
  substanceByQuestion,
  valuedDistribution,
} from "@/modules/qualitative-analysis/reading";
import type {
  Agreement,
  BestWork,
  SubstanceRow,
  ValuedDistribution,
} from "@/modules/qualitative-analysis/reading-types";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import { insightsScope } from "./authz";
import {
  completionSummary,
  type CompletionSummary,
} from "@/modules/analytics/completion";

export type SentimentGap = {
  dimension: string;
  /** Null: no self (or manager) comments of that dimension in reach. */
  self: SentimentCounts | null;
  manager: SentimentCounts | null;
};

export type SelfAssessmentReport = {
  /** The minimum group size applied (direction), else null. */
  minGroupSize: number | null;
  completion: CompletionSummary;
  /** Sentiment of the self reviews' comments, per dimension. */
  sentiment: DimensionSentiment[];
  /** Most frequent themes of the self reviews' comments. */
  themes: ThemeRank[];
  /** Manager − self (normalized) on the rating questions both answered. */
  gap: GapByQuestion[];
  /** For text-only cycles: sentiment of self vs manager comments per dimension. */
  sentimentGap: SentimentGap[];
  /**
   * The open-text reading of the self reviews (#129), the same readers as
   * /insights/qualitative: people per substance of their answer (self
   * side), "valued" 1-4 and best work, and the agreement with the manager.
   */
  substance: SubstanceRow[];
  valued: ValuedDistribution | null;
  bestWork: BestWork | null;
  agreement: Agreement;
};

/**
 * The self-assessment report of a cycle: how many self assessments were
 * submitted (per department or manager), what they say (sentiment and themes
 * of the self reviews only) and how they compare with the manager's (the
 * rating gap where both rated the same questions; the sentiment shares of
 * each side per dimension otherwise). Scope as insightsScope: People all, a
 * manager their direct reports, direction aggregates of at least the minimum
 * group size (no quotes, no names), an employee forbidden.
 */
export async function selfAssessmentReport(
  db: DbOrTx,
  actor: ActorContext,
  f: { cycleId: string; groupBy: "department" | "manager" },
): Promise<SelfAssessmentReport> {
  const minGroupSize = await getSetting(db, "aggregation.minGroupSize");
  const scope = insightsScope(actor, minGroupSize);
  if (scope.kind === "none") throw new ReviewError("forbidden");
  const min = scope.kind === "aggregatesOnly" ? scope.minGroupSize : null;
  const q = { cycleId: f.cycleId, minGroupSize };
  const [substance, valued, bestWork, agreement] = await Promise.all([
    substanceByQuestion(db, actor, { ...q, relationship: "self" }),
    valuedDistribution(db, actor, q),
    bestWorkOptions(db, actor, q),
    agreementBySide(db, actor, q),
  ]);
  const [done, self, manager, themes, gap] = await Promise.all([
    completionSummary(db, actor, { ...f, minGroupSize }),
    sentimentByDimension(db, actor, { ...q, relationship: "self" }),
    sentimentByDimension(db, actor, { ...q, relationship: "manager" }),
    topThemes(db, actor, { ...q, relationship: "self" }),
    // Direction has no people scope: the gap per question is computed over
    // everybody and only questions answered by at least the minimum show.
    selfManagerGap(
      db,
      min === null ? actor : ALL_PEOPLE,
      {
        cycleId: f.cycleId,
        hierarchy: "asOf",
        aggregateOnly: true,
      },
      { byPerson: false },
    ).then((g) => g.byQuestion.filter((row) => min === null || row.n >= min)),
  ]);
  const strip = (d: DimensionSentiment): SentimentCounts => pickCounts(d);
  const dimensions = [
    ...new Set([...self, ...manager].map((r) => r.dimension)),
  ].sort();
  return {
    minGroupSize: min,
    completion: done,
    sentiment: self,
    themes,
    gap,
    substance,
    valued: valued.total,
    bestWork,
    agreement,
    sentimentGap: dimensions.map((dimension) => {
      const s = self.find((r) => r.dimension === dimension);
      const m = manager.find((r) => r.dimension === dimension);
      return {
        dimension,
        self: s ? strip(s) : null,
        manager: m ? strip(m) : null,
      };
    }),
  };
}
