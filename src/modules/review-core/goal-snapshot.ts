import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleGoalLink,
  cycleParticipant,
  goal,
  type CycleParticipant,
  type Goal,
  type GoalStatus,
  participantGoalSnapshot,
  type QuestionRole,
  reviewCycle,
} from "@/db/schema";
import { todayLocal } from "@/modules/org-history/dates";
import type { CycleStatus } from "./status";

/*
 * Goals inside a cycle (PRD module 7, docs/research/06 "Goals linkage").
 *
 * - A participant's goals are copied into `participant_goal_snapshot` once,
 *   when the cycle launches (or when the participant is added): title, status,
 *   progress and due date "as of" that moment. Goals created later never
 *   appear. (Refreshing progress and linking goals by hand were UI flows,
 *   removed in #54; `refreshed_at`, `no_longer_applicable` and
 *   `cycle_goal_link` stay as data.)
 * - The goals rating (one rating for all goals) and its comment are ordinary
 *   questions of the manager template marked with a `role`. They are stored
 *   like any answer but apart from the overall rating, and they NEVER feed the
 *   final rating nor the calibration: whoever computes those must skip the
 *   questions for which `countsTowardOverall` is false.
 */

// ---------------------------------------------------------------- overlap

/** What the overlap rule looks at in a goal (dates are yyyy-mm-dd). */
export type GoalWindow = {
  status: GoalStatus;
  dueDate: string | null;
  completionDate: string | null;
  /**
   * When the goal started, if known. Imported (Bamboo) goals carry no start
   * date, so it is null for them (their row's created_at is the import date,
   * not the goal's): only native goals have one (their creation date).
   */
  startDate: string | null;
};

/**
 * Whether a goal belongs to a cycle by period: the goal's own span (from its
 * start, if known, to the day it ended or is due) overlaps [periodStart,
 * periodEnd], both ends included.
 *
 * - It ended (completion date, else due date) before the period began: no,
 *   even if it is still in progress (an old overdue goal is not this cycle's).
 * - It started after the period ended: no.
 * - It ended inside the period: yes, whatever its status (a closed goal is
 *   shown as closed).
 * - It ends after the period: yes, it was running through it.
 * - It has no end date: yes only while in progress (a closed or completed
 *   goal without dates gives no evidence that it ran in the period).
 */
export function goalOverlapsPeriod(
  g: GoalWindow,
  period: { periodStart: string; periodEnd: string },
): boolean {
  if (g.startDate && g.startDate > period.periodEnd) return false;
  const end = g.completionDate ?? g.dueDate;
  if (end && end < period.periodStart) return false;
  return end !== null || g.status === "in_progress";
}

/**
 * The manager's overall performance rating among the question revisions of a
 * cycle (the one marked `overall_rating`), if the template has it. The final
 * rating and the calibration start from this question, never from the goals
 * rating.
 */
export const overallRatingQuestion = <T extends { role: QuestionRole | null }>(
  revisions: readonly T[],
): T | undefined => revisions.find((q) => q.role === "overall_rating");

/**
 * Whether a question's answer may count toward the overall rating (and so the
 * final rating and calibration). The goals rating and its comment never do.
 */
export function countsTowardOverall(q: { role: QuestionRole | null }): boolean {
  return q.role !== "goals_rating" && q.role !== "goals_comment";
}

/** The goals rating or its comment. */
export const isGoalsQuestion = (q: { role: QuestionRole | null }) =>
  !countsTowardOverall(q);

// --------------------------------------------------------------- snapshot

const windowOf = (g: Goal): GoalWindow => ({
  status: g.status,
  dueDate: g.dueDate,
  completionDate: g.completionDate,
  // The creation day as the company counts it (not the UTC one).
  startDate: g.sourceSystem === "native" ? todayLocal(g.createdAt) : null,
});

/** The snapshot row of a goal as of `capturedAt`. */
function snapshotRow(participantId: string, g: Goal, capturedAt: Date) {
  return {
    participantId,
    goalId: g.id,
    goalSourceKey: `${g.sourceSystem}:${g.sourceId ?? g.id}`,
    title: g.title,
    status: g.status,
    percentComplete: g.percentComplete,
    dueDate: g.dueDate,
    capturedAt,
  };
}

/**
 * Takes the goal snapshot of participants (replacing the one they had, if any:
 * a participant added again gets a new one): their owner's live goals that
 * overlap the cycle's period (goalOverlapsPeriod) or were linked to the cycle
 * explicitly. `asOf` is the capture moment shown in the legend.
 */
export async function snapshotGoalsForParticipants(
  db: DbOrTx,
  participantIds: string[],
  asOf: Date = new Date(),
): Promise<void> {
  if (participantIds.length === 0) return;
  const participants = await db
    .select({
      id: cycleParticipant.id,
      cycleId: cycleParticipant.cycleId,
      ownerId: cycleParticipant.revieweePersonId,
      periodStart: reviewCycle.periodStart,
      periodEnd: reviewCycle.periodEnd,
    })
    .from(cycleParticipant)
    .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
    .where(inArray(cycleParticipant.id, participantIds));
  await db
    .delete(participantGoalSnapshot)
    .where(inArray(participantGoalSnapshot.participantId, participantIds));
  if (participants.length === 0) return;

  const goals = await db
    .select()
    .from(goal)
    .where(
      and(
        inArray(goal.personId, [
          ...new Set(participants.map((p) => p.ownerId)),
        ]),
        isNull(goal.deletedAt),
      ),
    )
    .orderBy(asc(goal.dueDate), asc(goal.title), asc(goal.id));
  const links = await db
    .select({ cycleId: cycleGoalLink.cycleId, goalId: cycleGoalLink.goalId })
    .from(cycleGoalLink)
    .where(
      inArray(cycleGoalLink.cycleId, [
        ...new Set(participants.map((p) => p.cycleId)),
      ]),
    );
  const linked = new Set(links.map((l) => `${l.cycleId}:${l.goalId}`));

  const rows = participants.flatMap((p) =>
    goals
      .filter(
        (g) =>
          g.personId === p.ownerId &&
          (linked.has(`${p.cycleId}:${g.id}`) ||
            goalOverlapsPeriod(windowOf(g), p)),
      )
      .map((g) => snapshotRow(p.id, g, asOf)),
  );
  // Chunked: a big launch must stay under the driver's parameter limit.
  for (let i = 0; i < rows.length; i += 1000) {
    await db.insert(participantGoalSnapshot).values(rows.slice(i, i + 1000));
  }
}

export const snapshotGoalsForParticipant = (
  db: DbOrTx,
  participantId: string,
  asOf?: Date,
) => snapshotGoalsForParticipants(db, [participantId], asOf);

/** Where a review lives: its participant and the cycle's phase. */
export type GoalsScope = {
  participant: Pick<
    CycleParticipant,
    "id" | "revieweePersonId" | "snapManagerPersonId" | "removedAt"
  >;
  cycle: { status: CycleStatus };
};

/**
 * Whether the goals rating and its comment are optional for a review: a
 * manager review of a participant whose snapshot has no goal that still
 * applies (a participant without goals must be able to submit).
 */
export async function goalsQuestionsOptional(
  db: DbOrTx,
  request: { relationship: string; participantId: string },
): Promise<boolean> {
  if (request.relationship !== "manager") return false;
  const [applicable] = await db
    .select({ id: participantGoalSnapshot.id })
    .from(participantGoalSnapshot)
    .where(
      and(
        eq(participantGoalSnapshot.participantId, request.participantId),
        eq(participantGoalSnapshot.noLongerApplicable, false),
      ),
    )
    .limit(1);
  return !applicable;
}
