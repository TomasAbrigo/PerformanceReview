// Pure and server-free: who sees what in the insights views. One function per
// concern; queries and pages ask it, none re-derives a rule from the role.
import type { ActorContext } from "@/modules/actor/types";
import { DEFAULT_SETTINGS } from "@/modules/settings/definitions";

/**
 * Which people a dashboard may read for an actor:
 * - `all`: People, everything, unmasked;
 * - `directReports`: a manager, the direct reports of the cycle snapshot;
 * - `aggregatesOnly`: direction, no individual, and groups of fewer than
 *   `minGroupSize` people are folded or hidden;
 * - `none`: nothing (employees, a manager acting without a person).
 */
export type InsightsScope =
  | { kind: "all" }
  | { kind: "directReports"; managerPersonId: string }
  | { kind: "aggregatesOnly"; minGroupSize: number }
  | { kind: "none" };

/**
 * `minGroupSize` is the `aggregation.minGroupSize` setting; the caller reads
 * it once per request and it only matters to direction.
 */
export function insightsScope(
  actor: ActorContext,
  minGroupSize: number = DEFAULT_SETTINGS["aggregation.minGroupSize"],
): InsightsScope {
  switch (actor.role) {
    case "hr":
      return { kind: "all" };
    case "manager":
      return actor.personId
        ? { kind: "directReports", managerPersonId: actor.personId }
        : { kind: "none" };
    case "direction":
      return { kind: "aggregatesOnly", minGroupSize };
    case "employee":
      return { kind: "none" };
  }
}

/** Whether the views may name people: People, and managers (their reports). */
export function canSeeIndividuals(actor: ActorContext): boolean {
  const { kind } = insightsScope(actor);
  return kind === "all" || kind === "directReports";
}

/**
 * Retention, engagement and sentiment about one person, who is `revieweePersonId`
 * and had `snapManagerPersonId` as manager in the cycle snapshot. They follow
 * the scope: People see them about anyone; a manager only about their direct
 * reports of the snapshot, never about themself; an employee never (not even
 * about themself), and direction only reads aggregates.
 */
export function canSeeSensitiveIndicators(
  actor: ActorContext,
  reviewee: {
    revieweePersonId: string;
    snapManagerPersonId: string | null;
  },
): boolean {
  const scope = insightsScope(actor);
  switch (scope.kind) {
    case "all":
      return true;
    case "directReports":
      return (
        reviewee.snapManagerPersonId === scope.managerPersonId &&
        reviewee.revieweePersonId !== scope.managerPersonId
      );
    case "aggregatesOnly":
    case "none":
      return false;
  }
}

/** The one-page executive view: People (unmasked) and direction (aggregates). */
export function canSeeExecutiveView(actor: ActorContext): boolean {
  const { kind } = insightsScope(actor);
  return kind === "all" || kind === "aggregatesOnly";
}
