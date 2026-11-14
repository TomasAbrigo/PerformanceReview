import type { HttpGet } from "./http";
import {
  goalCommentsSchema,
  goalsAggregateSchema,
  type BambooGoalComment,
  type BambooGoalsAggregate,
} from "./schemas";

/*
 * Goals live under /performance and are per employee only (no company-wide
 * query, no change feed). Their schemas are in ./schemas with all the others.
 */

/** Parsers shared with the fixture adapter, so files and API normalize alike. */
export const parseGoalsAggregate = (body: unknown) =>
  goalsAggregateSchema.parse(body);
export const parseGoalComments = (body: unknown) =>
  goalCommentsSchema.parse(body);

export type {
  BambooGoal,
  BambooGoalComment,
  BambooGoalMilestone,
  BambooGoalsAggregate,
} from "./schemas";

export type GoalsEndpoints = {
  /** All goals of an employee (closed ones included) with comment counts. */
  getGoalsAggregate(employeeId: string): Promise<BambooGoalsAggregate>;
  getGoalComments(
    employeeId: string,
    goalId: string,
  ): Promise<BambooGoalComment[]>;
};

export function createGoalsEndpoints(get: HttpGet): GoalsEndpoints {
  const employeePath = (employeeId: string) =>
    `/performance/employees/${encodeURIComponent(employeeId)}`;

  return {
    async getGoalsAggregate(employeeId) {
      return parseGoalsAggregate(
        await get(`/api/v1_2${employeePath(employeeId)}/goals/aggregate`, {
          filter: "status-all",
        }),
      );
    },

    async getGoalComments(employeeId, goalId) {
      return parseGoalComments(
        await get(
          `/api/v1${employeePath(employeeId)}/goals/${encodeURIComponent(goalId)}/comments`,
        ),
      );
    },
  };
}
