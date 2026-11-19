// Drizzle- and server-free: shared by the queries and the screens.
import type { GoalStatus } from "@/db/schema/goals";

/**
 * What a goal looks like to the people who follow it: its status, except
 * that an in-progress goal past its due date is `overdue`. One state per
 * goal, so the filter, the badge and the counts agree: the four states are a
 * partition (an overdue goal is not "in progress" too), so the parts of any
 * count add up to its total.
 *
 * THE rule of "Vencido" for the whole app (the goals list, the home, the goal
 * analytics, the executive view, the exports and the Arturía report all read
 * it): in progress and due before the reference date. The reference date is
 * `goalAsOf` below; a goal due ON it is not overdue yet.
 */
export const goalStates = [
  "in_progress",
  "completed",
  "closed",
  "overdue",
] as const;
export type GoalState = (typeof goalStates)[number];

export const isGoalStateFilter = (value: unknown): value is GoalState =>
  (goalStates as readonly unknown[]).includes(value);

/**
 * The state of a goal as of `asOf` (yyyy-mm-dd, the company's day, not the UTC
 * one): `overdue` when it is in progress and due before it.
 */
export function goalState(
  g: { status: GoalStatus; dueDate: string | null },
  asOf: string,
): GoalState {
  return g.status === "in_progress" && g.dueDate !== null && g.dueDate < asOf
    ? "overdue"
    : g.status;
}

/**
 * The reference date of "Vencido" (and of "due") for the goals of a cycle:
 * - while the cycle's period has not ended: today;
 * - once it is over and the cycle is closed: the end of its period, the date
 *   the goals' snapshot freezes at (an import takes it as of the period end,
 *   see `snapshotDateFor`; the cycle's own `snapshot_date` is the ORG snapshot,
 *   not the goals one). Measuring a frozen snapshot against today makes the
 *   figure grow with the calendar (a goal finished after the cut-off stays
 *   "in progress" in the snapshot for ever) and two cycles incomparable;
 * - a cycle still open after its period keeps syncing its goals: today.
 */
export function goalAsOf(
  cycle: { status: string; periodEnd: string },
  today: string,
): string {
  return cycle.status === "closed" && cycle.periodEnd < today
    ? cycle.periodEnd
    : today;
}
