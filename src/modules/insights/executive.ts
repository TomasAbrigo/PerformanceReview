import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { engagementTile } from "@/modules/analytics/engagement/queries";
import type { EngagementTile } from "@/modules/analytics/engagement/types";
import { goalKpis } from "@/modules/analytics/goals-insights/queries";
import type { GoalKpiGroup } from "@/modules/analytics/goals-insights/types";
import { indicatorSnapshot } from "@/modules/analytics/indicators/queries";
import type {
  IndicatorDistribution,
  RiskMatrix,
} from "@/modules/analytics/indicators/types";
import { topThemes } from "@/modules/qualitative-analysis/queries";
import {
  signalSummary,
  substanceByQuestion,
} from "@/modules/qualitative-analysis/reading";
import type {
  SignalSummary,
  SubstanceRow,
} from "@/modules/qualitative-analysis/reading-types";
import type { ThemeRank } from "@/modules/qualitative-analysis/types";
import type { OrgFilters } from "@/modules/org-attributes/kinds";
import { ReviewError } from "@/modules/review-core/review-errors";
import { getSetting } from "@/modules/settings/service";
import { type InsightsScope, insightsScope } from "./authz";
import {
  completionSummary,
  type CompletionSummary,
} from "@/modules/analytics/completion";

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
  completion: CompletionSummary;
  retention?: IndicatorSummary;
  engagement?: IndicatorSummary;
  /**
   * The risk matrix (retention × engagement bands): people in the risk
   * quadrant and with both indicators (null: masked) and the nine cells.
   * Never the names (`atRisk` is always null here).
   */
  risk?: RiskMatrix;
  /**
   * The open-text reading (#129), the same readers as /insights/qualitative:
   * people per substance of their answer, per question and side, and people
   * with each signal (null: masked).
   */
  substance?: SubstanceRow[];
  signals?: SignalSummary | null;
  /**
   * Goal KPIs of everybody in reach (#62); null when direction cannot see
   * them. `asOf` is the reference date (YYYY-MM-DD) "overdue" and "due" were
   * measured at: today, or the end of the period of a closed cycle.
   */
  goals?: (GoalKpiGroup & { asOf: string }) | null;
  /** Top 5 themes, counts only. */
  themes?: ThemeRank[];
  /**
   * The monthly engagement file (#86): the latest month with data next to the
   * one before, masked for direction; null when nothing was imported.
   */
  engagementMonthly?: EngagementTile | null;
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
  /** The `aggregation.minGroupSize` setting, read once per request. */
  minGroupSize: number;
  /** The org cuts the view narrows to (People only; direction reads everything). */
  filters: OrgFilters;
  /** Shared by the indicator blocks: one row load for all of them. */
  indicators: () => ReturnType<typeof indicatorSnapshot>;
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

const summary = (d: IndicatorDistribution): IndicatorSummary =>
  d.total ? { n: d.total.n, mean: d.total.mean, counts: d.total.counts } : null;

export const COLLECTORS: readonly Collector[] = [
  {
    key: "completion",
    modes: ALL,
    collect: ({ db, actor, cycleId, minGroupSize, filters }) =>
      completionSummary(db, actor, {
        cycleId,
        groupBy: "none",
        minGroupSize,
        ...filters,
      }),
  },
  {
    key: "retention",
    modes: QUANT,
    collect: async (ctx) => summary((await ctx.indicators()).retention),
  },
  {
    key: "engagement",
    modes: QUANT,
    collect: async (ctx) => summary((await ctx.indicators()).engagement),
  },
  {
    key: "risk",
    modes: QUANT,
    collect: async (ctx) => {
      const { matrix } = await ctx.indicators();
      return { ...matrix, atRisk: null };
    },
  },
  {
    key: "goals",
    modes: QUANT,
    collect: async ({ db, actor, cycleId, filters }) => {
      const k = await goalKpis(db, actor, {
        cycleId,
        groupBy: "department",
        filters,
      });
      return k.total ? { ...k.total, asOf: k.asOf } : null;
    },
  },
  {
    key: "engagementMonthly",
    modes: QUANT,
    collect: ({ db, actor, minGroupSize, filters }) =>
      engagementTile(db, actor, { ...filters, minGroupSize }),
  },
  {
    key: "substance",
    modes: QUAL,
    collect: ({ db, actor, cycleId, minGroupSize, filters }) =>
      substanceByQuestion(db, actor, {
        cycleId,
        aggregateOnly: true,
        minGroupSize,
        ...filters,
      }),
  },
  {
    key: "signals",
    modes: QUAL,
    collect: ({ db, actor, cycleId, minGroupSize, filters }) =>
      signalSummary(db, actor, {
        cycleId,
        aggregateOnly: true,
        minGroupSize,
        ...filters,
      }),
  },
  {
    key: "themes",
    modes: QUAL,
    collect: ({ db, actor, cycleId, minGroupSize, filters }) =>
      topThemes(
        db,
        actor,
        { cycleId, aggregateOnly: true, minGroupSize, ...filters },
        5,
      ),
  },
];

/**
 * The one-page executive view of a cycle: completion always, plus the
 * qualitative blocks (sentiment per dimension, top themes) and/or the
 * quantitative ones (retention, engagement, risk quadrant, goal KPIs) per `mode`.
 * People see everything unmasked (and may cut it by account, project, DM or
 * Santex Lead); direction only aggregates of at least the
 * `aggregation.minGroupSize` setting; managers and employees are forbidden.
 */
export async function executiveReport(
  db: DbOrTx,
  actor: ActorContext,
  f: {
    cycleId: string;
    mode: ExecutiveMode;
    minGroupSize?: number;
    /**
     * Narrow every block to an account, project, DM or Santex Lead (as of the
     * cycle snapshot). People only: direction reads the whole cycle, as its
     * completion view does, so no two cuts can be told apart.
     */
    filters?: OrgFilters;
  },
  collectors: readonly Collector[] = COLLECTORS,
): Promise<ExecutiveReport> {
  // Read once per request (the page passes it) and handed to every block.
  const minGroupSize =
    f.minGroupSize ?? (await getSetting(db, "aggregation.minGroupSize"));
  const scope = insightsScope(actor, minGroupSize);
  if (scope.kind !== "all" && scope.kind !== "aggregatesOnly") {
    throw new ReviewError("forbidden");
  }
  let snapshot: ReturnType<typeof indicatorSnapshot> | undefined;
  const filters = scope.kind === "all" ? (f.filters ?? {}) : {};
  const ctx: Ctx = {
    db,
    actor,
    scope,
    cycleId: f.cycleId,
    minGroupSize,
    filters,
    indicators: () =>
      (snapshot ??= indicatorSnapshot(db, actor, {
        cycleId: f.cycleId,
        config: { minGroupSize },
        filters,
      })),
  };
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
