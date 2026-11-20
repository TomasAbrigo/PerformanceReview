import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { selfManagerGap } from "@/modules/analytics/dashboards/queries";
import { ALL_PEOPLE } from "@/modules/analytics/dashboards/scope";
import type { GapByQuestion } from "@/modules/analytics/dashboards/types";
import {
  agreementBySide,
  bestWorkOptions,
  substanceByQuestion,
  themesBySide,
  valuedDistribution,
} from "@/modules/qualitative-analysis/reading";
import type {
  Agreement,
  BestWork,
  SubstanceRow,
  ThemesBySide,
  ValuedDistribution,
} from "@/modules/qualitative-analysis/reading-types";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import { insightsScope } from "./authz";
import {
  completionSummary,
  type CompletionSummary,
} from "@/modules/analytics/completion";

export type SelfAssessmentReport = {
  /** The minimum group size applied (direction), else null. */
  minGroupSize: number | null;
  completion: CompletionSummary;
  /** Manager − self (normalized) on the rating questions both answered. */
  gap: GapByQuestion[];
  /**
   * The open-text reading (#129), the same readers as /insights/qualitative,
   * in people: substance of the self answers per question, "valued" 1-4 and
   * best work, the themes of strengths and improvement (self and manager
   * side by side) and the agreement with the manager.
   */
  substance: SubstanceRow[];
  valued: ValuedDistribution | null;
  bestWork: BestWork | null;
  themes: ThemesBySide[];
  agreement: Agreement;
};

/**
 * The self-assessment report of a cycle: how many self assessments were
 * submitted (per department or manager), what they say (the open-text
 * reading per person) and how they compare with the manager's (the rating
 * gap where both rated the same questions; the agreement of their themes).
 * Scope as insightsScope: People all, a manager their direct reports (never
 * a self review the double blind keeps), direction aggregates of at least
 * the minimum group size (no quotes, no names), an employee forbidden.
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
  const [
    done,
    substance,
    valued,
    bestWork,
    strengths,
    improvement,
    agreement,
    gap,
  ] = await Promise.all([
    completionSummary(db, actor, { ...f, minGroupSize }),
    substanceByQuestion(db, actor, { ...q, relationship: "self" }),
    valuedDistribution(db, actor, q),
    bestWorkOptions(db, actor, q),
    themesBySide(db, actor, { ...q, dimension: "strengths" }),
    themesBySide(db, actor, { ...q, dimension: "improvement" }),
    agreementBySide(db, actor, q),
    // Direction has no people scope: the gap per question is computed over
    // everybody and only questions answered by at least the minimum show.
    selfManagerGap(
      db,
      min === null ? actor : ALL_PEOPLE,
      { cycleId: f.cycleId, hierarchy: "asOf", aggregateOnly: true },
      { byPerson: false },
    ).then((g) => g.byQuestion.filter((row) => min === null || row.n >= min)),
  ]);
  return {
    minGroupSize: min,
    completion: done,
    gap,
    substance,
    valued: valued.total,
    bestWork,
    themes: [strengths, improvement],
    agreement,
  };
}
