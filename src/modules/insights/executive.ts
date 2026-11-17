import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import {
  indicatorDistribution,
  riskMatrix,
} from "@/modules/analytics/indicators/queries";
import type { Indicator } from "@/modules/analytics/indicators/types";
import {
  sentimentByDimension,
  topThemes,
} from "@/modules/qualitative-analysis/queries";
import type {
  DimensionSentiment,
  ThemeRank,
} from "@/modules/qualitative-analysis/types";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import { type InsightsScope, insightsScope } from "./authz";
import { completion, type Completion } from "./completion";

/** The toggle of the executive view: comments, numbers, or both. */
export const executiveModes = ["qualitative", "quantitative", "both"] as const;
export type ExecutiveMode = (typeof executiveModes)[number];

/** An indicator of the whole cycle: null when direction cannot see it. */
export type IndicatorSummary = {
  n: number;
  mean: number | null;
  /** People per value 1-5. */
  counts: number[];
} | null;

/** The blocks of the view; a block the mode leaves out is absent. */
export type ExecutiveSections = {
  completion: Completion;
  retention?: IndicatorSummary;
  engagement?: IndicatorSummary;
  /** People in the risk quadrant and with both indicators (null: masked). */
  risk?: { riskCount: number | null; total: number | null };
  sentiment?: DimensionSentiment[];
  /** Top 5 themes, counts only. */
  themes?: ThemeRank[];
};

export type ExecutiveReport = ExecutiveSections & {
  cycleId: string;
  mode: ExecutiveMode;
  /** The minimum group size applied (direction), else null. */
  minGroupSize: number | null;
};

type Ctx = {
  db: DbOrTx;
  actor: ActorContext;
  scope: InsightsScope;
  cycleId: string;
};

/**
 * One block of the view: which modes show it and how it is read. Each reader
 * applies the actor's scope itself (the indicators, qualitative and
 * completion modules mask direction under the minimum group size), so a new
 * block (e.g. goals, #62) is one more entry here.
 */
type Collector = {
  [K in keyof ExecutiveSections]-?: {
    key: K;
    modes: readonly ExecutiveMode[];
    collect: (ctx: Ctx) => Promise<ExecutiveSections[K]>;
  };
}[keyof ExecutiveSections];

const ALL = executiveModes;
const QUAL = ["qualitative", "both"] as const;
const QUANT = ["quantitative", "both"] as const;

const indicator =
  (which: Indicator) =>
  async ({ db, actor, cycleId }: Ctx): Promise<IndicatorSummary> => {
    const d = await indicatorDistribution(db, actor, {
      cycleId,
      indicator: which,
      groupBy: "none",
    });
    return d.total
      ? { n: d.total.n, mean: d.total.mean, counts: d.total.counts }
      : null;
  };

export const COLLECTORS: readonly Collector[] = [
  {
    key: "completion",
    modes: ALL,
    collect: ({ db, scope, cycleId }) =>
      completion(db, scope, { cycleId, groupBy: "none" }),
  },
  { key: "retention", modes: QUANT, collect: indicator("retention") },
  { key: "engagement", modes: QUANT, collect: indicator("engagement") },
  {
    key: "risk",
    modes: QUANT,
    collect: async ({ db, actor, cycleId }) => {
      const m = await riskMatrix(db, actor, { cycleId });
      return { riskCount: m.riskCount, total: m.total };
    },
  },
  {
    key: "sentiment",
    modes: QUAL,
    collect: ({ db, actor, cycleId }) =>
      sentimentByDimension(db, actor, { cycleId, aggregateOnly: true }),
  },
  {
    key: "themes",
    modes: QUAL,
    collect: ({ db, actor, cycleId }) =>
      topThemes(db, actor, { cycleId, aggregateOnly: true }, 5),
  },
];

/**
 * The one-page executive view of a cycle: completion always, plus the
 * qualitative blocks (sentiment per dimension, top themes) and/or the
 * quantitative ones (retention, engagement, risk quadrant) per `mode`.
 * People see everything unmasked; direction only aggregates of at least the
 * `aggregation.minGroupSize` setting; managers and employees are forbidden.
 */
export async function executiveReport(
  db: DbOrTx,
  actor: ActorContext,
  f: { cycleId: string; mode: ExecutiveMode },
  collectors: readonly Collector[] = COLLECTORS,
): Promise<ExecutiveReport> {
  const scope = insightsScope(
    actor,
    actor.role === "direction"
      ? await getSetting(db, "aggregation.minGroupSize")
      : undefined,
  );
  if (scope.kind !== "all" && scope.kind !== "aggregatesOnly") {
    throw new ReviewError("forbidden");
  }
  const ctx: Ctx = { db, actor, scope, cycleId: f.cycleId };
  const picked = collectors.filter((c) => c.modes.includes(f.mode));
  const values = await Promise.all(picked.map((c) => c.collect(ctx)));
  const sections = Object.fromEntries(
    picked.map((c, i) => [c.key, values[i]]),
  ) as unknown as ExecutiveSections;
  return {
    ...sections,
    cycleId: f.cycleId,
    mode: f.mode,
    minGroupSize: scope.kind === "aggregatesOnly" ? scope.minGroupSize : null,
  };
}
