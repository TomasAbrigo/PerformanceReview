import {
  BambooError,
  type BambooClient,
  type BambooGoal,
  type BambooGoalComment,
  type BambooGoalsAggregate,
} from "@/modules/bamboo-client";
import type { ExtractedRecord, SkippedEmployee } from "./types";

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
 *
 * An employee Bamboo answers 403/404 for (no access, or gone since the list
 * was read) is reported through `onSkip` and left out: one bad employee must
 * not stop the rest. Anything else (bad credentials, rate limit, outage,
 * network, a bug) aborts, since going on would only repeat it.
 */
export async function* extractGoals(
  source: GoalSource,
  employeeIds: readonly string[],
  onSkip?: (skipped: SkippedEmployee) => void,
): AsyncIterable<ExtractedRecord> {
  for (const employeeId of employeeIds) {
    let aggregate: BambooGoalsAggregate;
    try {
      aggregate = await source.getGoalsAggregate(employeeId);
    } catch (err) {
      if (
        err instanceof BambooError &&
        (err.status === 403 || err.status === 404)
      ) {
        onSkip?.({ employeeId, status: err.status });
        continue;
      }
      throw err;
    }
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
