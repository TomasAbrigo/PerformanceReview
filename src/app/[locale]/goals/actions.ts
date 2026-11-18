"use server";

import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { getActor } from "@/modules/actor/server";
import {
  addMilestone,
  createGoal,
  setMilestoneDone,
  setProgress,
  setStatus,
  updateGoal,
} from "@/modules/goals/write";

/**
 * Goal writes. Each action reads the actor from the cookie and the module
 * re-checks `canEditGoal` (owner, current manager or People), so a button
 * hidden in the UI is never the only guard. Inputs come from forms: the
 * module validates them and answers with field issues.
 */

export async function createGoalAction(input: unknown) {
  const actor = await getActor();
  return actionResult(async () => createGoal(db, actor, input));
}

export async function updateGoalAction(goalId: string, input: unknown) {
  const actor = await getActor();
  return actionResult(() => updateGoal(db, actor, goalId, input));
}

export async function setProgressAction(goalId: string, percent: unknown) {
  const actor = await getActor();
  return actionResult(() => setProgress(db, actor, goalId, percent));
}

export async function setStatusAction(goalId: string, status: unknown) {
  const actor = await getActor();
  return actionResult(() => setStatus(db, actor, goalId, status));
}

export async function addMilestoneAction(goalId: string, title: string) {
  const actor = await getActor();
  return actionResult(async () => addMilestone(db, actor, goalId, { title }));
}

export async function setMilestoneDoneAction(
  milestoneId: string,
  done: boolean,
) {
  const actor = await getActor();
  return actionResult(() => setMilestoneDone(db, actor, milestoneId, done));
}
