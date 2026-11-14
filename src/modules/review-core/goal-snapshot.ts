import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleGoalLink,
  cycleParticipant,
  goal,
  type Goal,
  type GoalStatus,
  participantGoalSnapshot,
  type QuestionRole,
  reviewCycle,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { loadRequest } from "./requests";
import { ReviewError } from "./review-errors";
import type { CycleStatus } from "./status";

/*
 * Goals inside a cycle (PRD module 7, docs/research/06 "Goals linkage").
 *
 * - A participant's goals are copied into `participant_goal_snapshot` once,
 *   when the cycle launches (or when the participant is added): title, status,
 *   progress and due date "as of" that moment. Goals created later never
 *   appear; "update progress" only refreshes the figures of the rows that are
 *   there, and flags the ones whose goal was deleted ("ya no aplica").
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

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const windowOf = (g: Goal): GoalWindow => ({
  status: g.status,
  dueDate: g.dueDate,
  completionDate: g.completionDate,
  startDate: g.sourceSystem === "native" ? isoDay(g.createdAt) : null,
});

/** The snapshot row of a goal as of `capturedAt`. */
function snapshotRow(participantId: string, g: Goal, capturedAt: Date) {
  return {
    participantId,
    goalId: g.id,
    goalSourceId: g.sourceId ?? g.id,
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

// ---------------------------------------------------------------- refresh

type Scope = {
  participant: { snapManagerPersonId: string | null; removedAt: Date | null };
  cycle: { status: CycleStatus };
};

/** Phases in which the snapshot may still be refreshed or extended. */
const isLive = ({ participant, cycle }: Scope) =>
  participant.removedAt === null &&
  cycle.status !== "draft" &&
  cycle.status !== "closed";

/** People (HR) and the participant's snapshot manager refresh the progress. */
const mayRefresh = (actor: ActorContext, { participant }: Scope) =>
  actor.role === "hr" ||
  (actor.role === "manager" &&
    actor.personId !== null &&
    actor.personId === participant.snapManagerPersonId);

/**
 * "Update progress": refreshes status and progress of the participant's
 * snapshot goals from the goals as they are now and stamps `refreshed_at`
 * (the legend date). It never adds goals nor touches titles or due dates; a
 * goal that was deleted is flagged `no_longer_applicable` and keeps the
 * figures it had. HR or the snapshot manager, while the cycle is live.
 */
export async function refreshGoalProgress(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(participantId)) throw new ReviewError("not_found");
  await db.transaction(async (tx) => {
    const [scope] = await tx
      .select({
        participant: cycleParticipant,
        cycle: { status: reviewCycle.status },
      })
      .from(cycleParticipant)
      .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId))
      .where(eq(cycleParticipant.id, participantId));
    if (!scope) throw new ReviewError("not_found");
    if (!mayRefresh(actor, scope) || !isLive(scope)) {
      throw new ReviewError("forbidden");
    }
    const rows = await tx
      .select()
      .from(participantGoalSnapshot)
      .where(eq(participantGoalSnapshot.participantId, participantId))
      .for("update");
    const goalIds = rows.flatMap((r) => (r.goalId ? [r.goalId] : []));
    const live = new Map(
      (goalIds.length
        ? await tx.select().from(goal).where(inArray(goal.id, goalIds))
        : []
      ).map((g) => [g.id, g]),
    );
    for (const row of rows) {
      const current = row.goalId ? live.get(row.goalId) : undefined;
      const gone = !current || current.deletedAt !== null;
      await tx
        .update(participantGoalSnapshot)
        .set(
          gone
            ? { noLongerApplicable: true, refreshedAt: now }
            : {
                status: current.status,
                percentComplete: current.percentComplete,
                noLongerApplicable: false,
                refreshedAt: now,
              },
        )
        .where(eq(participantGoalSnapshot.id, row.id));
    }
  });
}

// ------------------------------------------------------------------- link

/**
 * People attaches a goal to a cycle explicitly (one the period overlap did
 * not pick up). It is remembered (so a participant added later gets it) and,
 * if the goal's owner is already a participant, added to their snapshot with
 * the goal's current figures. HR only, before the cycle closes. Idempotent.
 */
export async function linkGoalToCycle(
  db: DbOrTx,
  actor: ActorContext,
  cycleId: string,
  goalId: string,
): Promise<void> {
  if (actor.role !== "hr") throw new ReviewError("forbidden");
  if (!isUuid(cycleId) || !isUuid(goalId)) throw new ReviewError("not_found");
  await db.transaction(async (tx) => {
    const [cycle] = await tx
      .select({ status: reviewCycle.status })
      .from(reviewCycle)
      .where(and(eq(reviewCycle.id, cycleId), isNull(reviewCycle.deletedAt)));
    const [target] = await tx
      .select()
      .from(goal)
      .where(and(eq(goal.id, goalId), isNull(goal.deletedAt)));
    if (!cycle || !target) throw new ReviewError("not_found");
    if (cycle.status === "closed") throw new ReviewError("forbidden");
    await tx
      .insert(cycleGoalLink)
      .values({ cycleId, goalId, linkedBy: actor.personId })
      .onConflictDoNothing();
    const [owner] = await tx
      .select({ id: cycleParticipant.id })
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycleId),
          eq(cycleParticipant.revieweePersonId, target.personId),
          isNull(cycleParticipant.removedAt),
        ),
      );
    if (!owner) return; // not a participant (yet): the link waits
    await tx
      .insert(participantGoalSnapshot)
      .values(snapshotRow(owner.id, target, new Date()))
      .onConflictDoNothing();
  });
}

// ------------------------------------------------------------------ reads

export type GoalSnapshotView = {
  id: string;
  title: string;
  status: GoalStatus;
  percentComplete: number;
  /** yyyy-mm-dd */
  dueDate: string | null;
  noLongerApplicable: boolean;
};

export type GoalsBlockData = {
  participantId: string;
  goals: GoalSnapshotView[];
  /** The legend date ("progress as of"): latest refresh, else the capture. */
  asOf: Date | null;
  canRefresh: boolean;
  canLink: boolean;
  /** Owner's live goals that are not in the snapshot (HR can link them). */
  linkable: { id: string; title: string }[];
};

/**
 * The goals block of a review the actor can read (the request's participant's
 * snapshot): null when the request is not visible. Goals are never filtered
 * out: the reviewee sees the same list as their manager.
 */
export async function getReviewGoals(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
): Promise<GoalsBlockData | null> {
  let loaded;
  try {
    loaded = await loadRequest(db, actor, requestId);
  } catch (error) {
    if (error instanceof ReviewError) return null;
    throw error;
  }
  const { participant, cycle } = loaded;
  const rows = await db
    .select()
    .from(participantGoalSnapshot)
    .where(eq(participantGoalSnapshot.participantId, participant.id))
    .orderBy(
      sql`${participantGoalSnapshot.dueDate} asc nulls last`,
      asc(participantGoalSnapshot.title),
      asc(participantGoalSnapshot.id),
    );
  const scope = { participant, cycle };
  const canLink =
    actor.role === "hr" && cycle.status !== "closed" && !participant.removedAt;
  const inSnapshot = new Set(rows.flatMap((r) => (r.goalId ? [r.goalId] : [])));
  const linkable = canLink
    ? (
        await db
          .select({ id: goal.id, title: goal.title })
          .from(goal)
          .where(
            and(
              eq(goal.personId, participant.revieweePersonId),
              isNull(goal.deletedAt),
            ),
          )
          .orderBy(asc(goal.title), asc(goal.id))
      ).filter((g) => !inSnapshot.has(g.id))
    : [];
  const dates = rows.map((r) => (r.refreshedAt ?? r.capturedAt).getTime());
  return {
    participantId: participant.id,
    goals: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      percentComplete: r.percentComplete,
      dueDate: r.dueDate,
      noLongerApplicable: r.noLongerApplicable,
    })),
    asOf: dates.length ? new Date(Math.max(...dates)) : null,
    canRefresh: rows.length > 0 && mayRefresh(actor, scope) && isLive(scope),
    canLink,
    linkable,
  };
}

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
