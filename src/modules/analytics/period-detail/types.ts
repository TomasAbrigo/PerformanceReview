// Drizzle- and server-free: shared by the queries, the export and client components.
import type { LocalizedText } from "@/db/schema/rating-scales";

/** A mean over `n` people. */
export type MeanOf = { n: number; mean: number };

/**
 * One review cycle of the "Detalle por período" table. The rates are 0-1 and
 * `goalsCompletedPct` 0-100; a figure is null when there is nothing to
 * average, or (direction) when the group is under the minimum.
 */
export type PeriodDetailRow = {
  cycleId: string;
  cycleName: string;
  /** The name in each language when the cycle was generated (see `cycleName`). */
  localizedName: LocalizedText | null;
  periodStart: string;
  periodEnd: string;
  /** People in the cycle (the head count is shown even under the minimum). */
  participants: number;
  /** Self and manager assessments submitted over those they apply to. */
  selfRate: number | null;
  managerRate: number | null;
  /** Self "does the company recognize my value?", 1-4. */
  valued: MeanOf | null;
  /** Manager "does [Employee] feel valued?" (retention), 1-5. */
  retention: MeanOf | null;
  /** Manager "how engaged is [Employee]?" (Bamboo's engagement), 1-5. */
  engagement: MeanOf | null;
  /**
   * Goals of the period completed, of the ones that were due by the cycle's
   * reference date (`goalAsOf`: today while it runs, the end of its period
   * once closed): a goal not due yet is not a failure, so this is the rate
   * that can sit next to a target. Null when none was due.
   */
  goalsCompletedPct: number | null;
  /** The goals that were due by then: the base of `goalsCompletedPct`. */
  goals: number | null;
};

export type PeriodDetail = {
  /** Oldest cycle first. */
  rows: PeriodDetailRow[];
  /** The minimum group size applied (direction), else null. */
  minGroupSize: number | null;
};
