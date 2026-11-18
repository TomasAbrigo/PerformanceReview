import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { goal, goalMilestone } from "@/db/schema/goals";
import { DomainError, parse } from "@/lib/domain-error";
import { jobValidOn, rowsOf } from "@/lib/sql";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { todayLocal } from "@/modules/org-history/dates";
import { canEditGoal } from "./permissions";

export class GoalError extends DomainError<
  "validation" | "forbidden" | "not_found"
> {}

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "invalid_date");
const title = z.string().trim().min(1, "required").max(300, "too_long");
const description = z
  .string()
  .trim()
  .max(5000, "too_long")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optionalDay = z
  .union([day, z.literal("")])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const createGoalSchema = z.object({
  /** The owner; defaults to the actor. */
  personId: z.string().optional(),
  title,
  description,
  dueDate: optionalDay,
});
export const updateGoalSchema = z.object({
  title,
  description,
  dueDate: optionalDay,
});

/** Whether `actorId` is `personId`'s manager today. */
export async function isCurrentManagerOf(
  db: DbOrTx,
  actorId: string | null,
  personId: string,
  today: string = todayLocal(),
): Promise<boolean> {
  if (!actorId) return false;
  const rows = rowsOf(
    await db.execute(sql`
      select 1 from employee_job_history h
      where h.person_id = ${personId}::uuid
        and h.manager_person_id = ${actorId}::uuid
        and ${jobValidOn("h", today)}
      limit 1`),
  );
  return rows.length > 0;
}

/** Whether `actor` may edit goals of `personId` (the rule plus today's manager). */
export async function canEditGoalsOf(
  db: DbOrTx,
  actor: ActorContext,
  personId: string,
  today: string = todayLocal(),
): Promise<boolean> {
  const isCurrentManager =
    actor.role === "manager" &&
    (await isCurrentManagerOf(db, actor.personId, personId, today));
  return canEditGoal(actor, { personId }, { isCurrentManager });
}

async function requireEditPerson(
  db: DbOrTx,
  actor: ActorContext,
  personId: string,
  today: string,
): Promise<void> {
  if (!(await canEditGoalsOf(db, actor, personId, today))) {
    throw new GoalError("forbidden");
  }
}

/** Loads a live goal and checks the actor may edit it (`not_found` before `forbidden`). */
async function loadEditable(
  db: DbOrTx,
  actor: ActorContext,
  goalId: string,
  today: string,
) {
  if (!isUuid(goalId)) throw new GoalError("not_found");
  const [row] = await db
    .select({ id: goal.id, personId: goal.personId })
    .from(goal)
    .where(and(eq(goal.id, goalId), isNull(goal.deletedAt)));
  if (!row) throw new GoalError("not_found");
  await requireEditPerson(db, actor, row.personId, today);
  return row;
}

const touch = (now: Date) => ({ lastChangedAt: now, updatedAt: now });

/** Creates a goal (`native`) for `personId` (default: the actor). */
export async function createGoal(
  db: DbOrTx,
  actor: ActorContext,
  input: unknown,
  today: string = todayLocal(),
): Promise<{ id: string }> {
  const v = parse(createGoalSchema, input, GoalError);
  const personId = v.personId || actor.personId;
  if (!personId || !isUuid(personId)) {
    throw new GoalError("validation", [
      { path: "personId", message: "required" },
    ]);
  }
  await requireEditPerson(db, actor, personId, today);
  const owner = rowsOf(
    await db.execute(sql`select 1 from person where id = ${personId}::uuid`),
  );
  if (owner.length === 0) {
    throw new GoalError("validation", [
      { path: "personId", message: "unknown_person" },
    ]);
  }
  const [row] = await db
    .insert(goal)
    .values({
      personId,
      title: v.title,
      description: v.description ?? null,
      dueDate: v.dueDate ?? null,
      sourceSystem: "native",
      ...touch(new Date()),
    })
    .returning({ id: goal.id });
  return row;
}

export async function updateGoal(
  db: DbOrTx,
  actor: ActorContext,
  goalId: string,
  input: unknown,
  today: string = todayLocal(),
): Promise<void> {
  const v = parse(updateGoalSchema, input, GoalError);
  await loadEditable(db, actor, goalId, today);
  await db
    .update(goal)
    .set({
      title: v.title,
      description: v.description ?? null,
      dueDate: v.dueDate ?? null,
      ...touch(new Date()),
    })
    .where(eq(goal.id, goalId));
}

export async function setProgress(
  db: DbOrTx,
  actor: ActorContext,
  goalId: string,
  percent: unknown,
  today: string = todayLocal(),
): Promise<void> {
  const v = parse(
    z.object({ percent: z.number().int().min(0).max(100) }),
    { percent },
    GoalError,
  );
  await loadEditable(db, actor, goalId, today);
  await db
    .update(goal)
    .set({ percentComplete: v.percent, ...touch(new Date()) })
    .where(eq(goal.id, goalId));
}

/**
 * Completes (100 %, completion date today), closes (not counted as done) or
 * reopens (`in_progress`, completion date cleared) a goal.
 */
export async function setStatus(
  db: DbOrTx,
  actor: ActorContext,
  goalId: string,
  status: unknown,
  today: string = todayLocal(),
): Promise<void> {
  const v = parse(
    z.object({ status: z.enum(["in_progress", "completed", "closed"]) }),
    { status },
    GoalError,
  );
  await loadEditable(db, actor, goalId, today);
  await db
    .update(goal)
    .set({
      status: v.status,
      completionDate: v.status === "completed" ? today : null,
      ...(v.status === "completed" ? { percentComplete: 100 } : {}),
      ...touch(new Date()),
    })
    .where(eq(goal.id, goalId));
}

export async function addMilestone(
  db: DbOrTx,
  actor: ActorContext,
  goalId: string,
  input: unknown,
  today: string = todayLocal(),
): Promise<{ id: string }> {
  const v = parse(
    z.object({
      title: z.string().trim().min(1, "required").max(300, "too_long"),
    }),
    input,
    GoalError,
  );
  await loadEditable(db, actor, goalId, today);
  const [next] = rowsOf<{ next: number }>(
    await db.execute(sql`
      select coalesce(max(position) + 1, 0)::int as next
      from goal_milestone
      where goal_id = ${goalId}::uuid and deleted_at is null`),
  );
  const now = new Date();
  const [row] = await db
    .insert(goalMilestone)
    .values({
      goalId,
      title: v.title,
      position: next.next,
      sourceSystem: "native",
      lastUpdateAt: now,
    })
    .returning({ id: goalMilestone.id });
  await db.update(goal).set(touch(now)).where(eq(goal.id, goalId));
  return row;
}

/** Marks a milestone done (or open again). */
export async function setMilestoneDone(
  db: DbOrTx,
  actor: ActorContext,
  milestoneId: string,
  done: boolean,
  today: string = todayLocal(),
): Promise<void> {
  if (!isUuid(milestoneId)) throw new GoalError("not_found");
  const [m] = await db
    .select({ goalId: goalMilestone.goalId })
    .from(goalMilestone)
    .where(
      and(eq(goalMilestone.id, milestoneId), isNull(goalMilestone.deletedAt)),
    );
  if (!m) throw new GoalError("not_found");
  await loadEditable(db, actor, m.goalId, today);
  const now = new Date();
  await db
    .update(goalMilestone)
    .set({ completedAt: done ? now : null, lastUpdateAt: now, updatedAt: now })
    .where(eq(goalMilestone.id, milestoneId));
  await db.update(goal).set(touch(now)).where(eq(goal.id, m.goalId));
}

export type GoalOwnerOption = { id: string; name: string };

/**
 * The people `actor` may create a goal for (the owner select of "New goal"):
 * People everybody; a manager themself and their direct reports today; an
 * employee themself; direction nobody. The actor comes first.
 */
export async function listGoalOwnerOptions(
  db: DbOrTx,
  actor: ActorContext,
  today: string = todayLocal(),
): Promise<GoalOwnerOption[]> {
  if (actor.role === "direction") return [];
  const me = actor.personId;
  const scope =
    actor.role === "hr"
      ? sql`true`
      : me
        ? actor.role === "manager"
          ? sql`(p.id = ${me}::uuid or exists (
              select 1 from employee_job_history h
              where h.person_id = p.id and h.manager_person_id = ${me}::uuid
                and ${jobValidOn("h", today)}))`
          : sql`p.id = ${me}::uuid`
        : sql`false`;
  const first = me ? sql`(p.id = ${me}::uuid) desc,` : sql``;
  return rowsOf<GoalOwnerOption>(
    await db.execute(sql`
      select p.id, p.display_name as name from person p
      where ${scope}
      order by ${first} p.display_name, p.id`),
  );
}
