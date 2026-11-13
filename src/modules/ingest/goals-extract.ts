import type {
  BambooClient,
  BambooGoal,
  BambooGoalComment,
} from "@/modules/bamboo-client";
import type { ExtractedRecord } from "./types";

/** What the goal extraction needs from Bamboo: the API client or a fixture. */
export type GoalSource = Pick<
  BambooClient,
  "getGoalsAggregate" | "getGoalComments"
>;

/**
 * raw_record payload of a goal: the goal as Bamboo returned it (ids
 * normalized to strings) plus where it was read from and its comment count.
 */
export type GoalPayload = {
  /** Bamboo employee whose aggregate contained the goal. */
  employeeId: string;
  commentCount: number;
  goal: BambooGoal;
};

/** A comment plus the author's employee id (Bamboo only gives a user id). */
export type GoalCommentPayload = BambooGoalComment & {
  authorEmployeeId: string | null;
};

/**
 * One record per goal of each employee (closed goals included). A goal shared
 * with several people shows up once per aggregate that contains it; deciding
 * who owns it is up to the caller. Comments are lazy: `loadComments` does the
 * request when called.
 */
export async function* extractGoals(
  source: GoalSource,
  employeeIds: readonly string[],
): AsyncIterable<ExtractedRecord> {
  for (const employeeId of employeeIds) {
    const aggregate = await source.getGoalsAggregate(employeeId);
    const extractedAt = new Date();
    const counts = new Map(
      aggregate.comments.map((c) => [c.goalId, c.commentCount]),
    );
    const employeeByUser = new Map<string, string>();
    for (const p of aggregate.persons) {
      if (p.userId && p.employeeId) employeeByUser.set(p.userId, p.employeeId);
    }

    for (const goal of aggregate.goals) {
      const payload: GoalPayload = {
        employeeId,
        commentCount: counts.get(goal.id) ?? 0,
        goal,
      };
      yield {
        sourceId: goal.id,
        payload,
        extractedAt,
        loadComments: async (): Promise<GoalCommentPayload[]> =>
          (await source.getGoalComments(employeeId, goal.id)).map((c) => ({
            ...c,
            authorEmployeeId:
              (c.authorUserId && employeeByUser.get(c.authorUserId)) || null,
          })),
      };
    }
  }
}
