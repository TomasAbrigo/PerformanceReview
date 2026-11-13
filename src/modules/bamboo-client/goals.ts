import { z } from "zod";
import type { HttpGet } from "./http";
import { bambooId, nullableBambooId } from "./schemas";

/*
 * Goals live under /performance and are per employee only (no company-wide
 * query, no change feed). Ids come back as numbers or strings depending on
 * the field: everything is normalized to string here. Unknown fields pass
 * through untouched.
 */

const milestoneSchema = z.looseObject({
  id: bambooId,
  employeeGoalId: nullableBambooId,
  title: z.string().nullish(),
  currentValue: z.number().nullish(),
  startValue: z.number().nullish(),
  endValue: z.number().nullish(),
  completedDateTime: z.string().nullish(),
  lastUpdateDateTime: z.string().nullish(),
  lastUpdateUserId: nullableBambooId,
});

const goalSchema = z
  .looseObject({
    id: bambooId,
    title: z.string().nullish(),
    description: z.string().nullish(),
    percentComplete: z.number().nullish(),
    alignsWithOptionId: nullableBambooId,
    sharedWithEmployeeIds: z.array(bambooId).nullish(),
    dueDate: z.string().nullish(),
    completionDate: z.string().nullish(),
    lastChangedDateTime: z.string().nullish(),
    // Kept as text: a status we do not know must reject one goal at staging,
    // not make the whole aggregate unreadable.
    status: z.string().nullish(),
    milestones: z.array(milestoneSchema).nullish(),
  })
  .transform((g) => ({
    ...g,
    sharedWithEmployeeIds: g.sharedWithEmployeeIds ?? [],
    // Goals without milestones come as null, [] or no key at all.
    milestones: g.milestones ?? [],
  }));

const goalsAggregateSchema = z
  .looseObject({
    goals: z.array(goalSchema).nullish(),
    // Users and employees are different id spaces: persons maps one to the other.
    persons: z
      .array(
        z.looseObject({
          employeeId: nullableBambooId,
          userId: nullableBambooId,
        }),
      )
      .nullish(),
    /** Per-goal comment counts (the comments themselves need another call). */
    comments: z
      .array(z.looseObject({ goalId: bambooId, commentCount: z.number() }))
      .nullish(),
  })
  .transform((a) => ({
    ...a,
    goals: a.goals ?? [],
    persons: a.persons ?? [],
    comments: a.comments ?? [],
  }));

const goalCommentSchema = z
  .looseObject({
    id: bambooId,
    authorUserId: nullableBambooId,
    text: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .transform((c) => ({ ...c, authorUserId: c.authorUserId ?? null }));

const goalCommentsSchema = z
  .union([
    z.array(goalCommentSchema),
    z.looseObject({ comments: z.array(goalCommentSchema).nullish() }),
  ])
  .transform((r) => (Array.isArray(r) ? r : (r.comments ?? [])));

/** Parsers shared with the fixture adapter, so files and API normalize alike. */
export const parseGoalsAggregate = (body: unknown) =>
  goalsAggregateSchema.parse(body);
export const parseGoalComments = (body: unknown) =>
  goalCommentsSchema.parse(body);

export type BambooGoal = z.infer<typeof goalSchema>;
export type BambooGoalMilestone = BambooGoal["milestones"][number];
export type BambooGoalsAggregate = z.infer<typeof goalsAggregateSchema>;
export type BambooGoalComment = z.infer<typeof goalCommentSchema>;

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
