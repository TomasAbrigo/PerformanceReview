import { ReviewError } from "@/modules/review-core/review-errors";
import type { IndicatorActor } from "./types";

/**
 * What an actor may read of the retention and engagement indicators: People
 * everything; a manager their direct reports of the snapshot; direction only
 * aggregates of groups of at least the minimum; everybody else (employees,
 * also about themselves) nothing.
 *
 * TODO(#56): replace by `insightsScope` of src/modules/insights/authz once it
 * lands (same four values).
 */
export type IndicatorScope =
  "all" | "directReports" | "aggregatesOnly" | "none";

export function indicatorScope(actor: IndicatorActor): IndicatorScope {
  switch (actor.role) {
    case "hr":
      return "all";
    case "manager":
      return actor.personId ? "directReports" : "none";
    case "direction":
      return "aggregatesOnly";
    default:
      return "none";
  }
}

/** The scope of an actor allowed to read at all; `forbidden` otherwise. */
export function requireIndicatorScope(
  actor: IndicatorActor,
): Exclude<IndicatorScope, "none"> {
  const scope = indicatorScope(actor);
  if (scope === "none") throw new ReviewError("forbidden");
  return scope;
}
