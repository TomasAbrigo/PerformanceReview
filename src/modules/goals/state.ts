// Drizzle- and server-free: shared by the queries and the screens.
import type { GoalStatus } from "@/db/schema/goals";

/**
 * What a goal looks like to the people who follow it: its status, except
 * that an in-progress goal past its due date is `overdue`. One state per
 * goal, so the filter, the badge and the counts agree.
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

/** `today` and `dueDate` are yyyy-mm-dd (the company's day, not the UTC one). */
export function goalState(
  g: { status: GoalStatus; dueDate: string | null },
  today: string,
): GoalState {
  return g.status === "in_progress" && g.dueDate !== null && g.dueDate < today
    ? "overdue"
    : g.status;
}
