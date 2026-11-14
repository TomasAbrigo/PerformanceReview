"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();

export async function shareAction(requestId: string) {
  return actionResult(async () => {
    await review.shareReview(
      db,
      await getActor(),
      parse(id, requestId, review.ReviewError),
    );
  });
}

/** HR: shares every submitted manager review of the cycle. */
export async function shareAllAction(cycleId: string) {
  return actionResult(async () => ({
    count: await review.shareAll(
      db,
      await getActor(),
      parse(id, cycleId, review.ReviewError),
    ),
  }));
}

export async function remindAction(requestId: string) {
  return actionResult(async () => {
    await review.sendReminder(
      db,
      await getActor(),
      parse(id, requestId, review.ReviewError),
    );
  });
}
