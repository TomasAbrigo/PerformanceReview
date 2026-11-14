"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();

/** "Update progress": refreshes the participant's goal snapshot figures. */
export async function refreshGoalsAction(participantId: string) {
  return actionResult(async () => {
    await review.refreshGoalProgress(
      db,
      await getActor(),
      parse(id, participantId, review.ReviewError),
    );
  });
}

/** People links one more goal to the cycle (bound to the cycle by the page). */
export async function linkGoalAction(cycleId: string, goalId: string) {
  return actionResult(async () => {
    await review.linkGoalToCycle(
      db,
      await getActor(),
      parse(id, cycleId, review.ReviewError),
      parse(id, goalId, review.ReviewError),
    );
  });
}
