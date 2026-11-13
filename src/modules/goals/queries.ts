import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  goal,
  goalMilestone,
  goalShare,
  person,
  type GoalStatus,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { listDirectReports } from "./direct-reports";

export type GoalMilestoneView = {
  id: string;
  title: string;
  completedAt: Date | null;
};

export type GoalView = {
  id: string;
  title: string;
  description: string | null;
  percentComplete: number;
  status: GoalStatus;
  /** yyyy-mm-dd */
  dueDate: string | null;
  completionDate: string | null;
  commentCount: number;
  milestones: GoalMilestoneView[];
  sharedWith: { personId: string; displayName: string }[];
};

export type TeamGoalsReport = {
  person: { id: string; displayName: string };
  goals: GoalView[];
};

export type TeamGoalsData = {
  manager: { id: string; displayName: string };
  reports: TeamGoalsReport[];
};

/** Groups `items` by key, keeping their order within each group. */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/** Goals of the given people (never deleted ones), by due date, none last. */
async function loadGoals(
  db: DbOrTx,
  personIds: string[],
): Promise<Map<string, GoalView[]>> {
  const byPerson = new Map<string, GoalView[]>(personIds.map((id) => [id, []]));
  if (personIds.length === 0) return byPerson;

  const rows = await db
    .select()
    .from(goal)
    .where(and(inArray(goal.personId, personIds), isNull(goal.deletedAt)))
    .orderBy(
      sql`${goal.dueDate} asc nulls last`,
      asc(goal.title),
      asc(goal.id),
    );
  if (rows.length === 0) return byPerson;
  const goalIds = rows.map((g) => g.id);

  const milestones = await db
    .select()
    .from(goalMilestone)
    .where(
      and(
        inArray(goalMilestone.goalId, goalIds),
        isNull(goalMilestone.deletedAt),
      ),
    )
    .orderBy(asc(goalMilestone.position), asc(goalMilestone.id));
  const shares = await db
    .select({
      goalId: goalShare.goalId,
      personId: person.id,
      displayName: person.displayName,
    })
    .from(goalShare)
    .innerJoin(person, eq(person.id, goalShare.personId))
    .where(inArray(goalShare.goalId, goalIds))
    .orderBy(asc(person.displayName), asc(person.id));

  const milestonesByGoal = groupBy(milestones, (m) => m.goalId);
  const sharesByGoal = groupBy(shares, (s) => s.goalId);
  for (const g of rows) {
    byPerson.get(g.personId)?.push({
      id: g.id,
      title: g.title,
      description: g.description,
      percentComplete: g.percentComplete,
      status: g.status,
      dueDate: g.dueDate,
      completionDate: g.completionDate,
      commentCount: g.commentCount,
      milestones: (milestonesByGoal.get(g.id) ?? []).map((m) => ({
        id: m.id,
        title: m.title,
        completedAt: m.completedAt,
      })),
      sharedWith: (sharesByGoal.get(g.id) ?? []).map((s) => ({
        personId: s.personId,
        displayName: s.displayName,
      })),
    });
  }
  return byPerson;
}

/** The goals a person owns, ordered by due date. */
export async function listPersonGoals(
  db: DbOrTx,
  personId: string,
): Promise<GoalView[]> {
  if (!isUuid(personId)) return [];
  return (await loadGoals(db, [personId])).get(personId) ?? [];
}

/**
 * A manager's direct reports (today) with the goals of each. Null when the
 * manager does not exist. Reports without goals appear with an empty list.
 */
export async function getTeamGoals(
  db: DbOrTx,
  managerPersonId: string,
): Promise<TeamGoalsData | null> {
  if (!isUuid(managerPersonId)) return null;
  const [manager] = await db
    .select({ id: person.id, displayName: person.displayName })
    .from(person)
    .where(eq(person.id, managerPersonId));
  if (!manager) return null;

  const reports = await listDirectReports(db, manager.id);
  const goals = await loadGoals(
    db,
    reports.map((r) => r.id),
  );
  return {
    manager,
    reports: reports.map((r) => ({
      person: { id: r.id, displayName: r.displayName },
      goals: goals.get(r.id) ?? [],
    })),
  };
}
