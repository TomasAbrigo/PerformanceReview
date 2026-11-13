"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/templates/shared";
import { db } from "@/db/client";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();

async function result(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof review.ReviewError) {
      return { ok: false, code: error.code, issues: error.issues };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, code: "validation", issues: [] };
    }
    console.error(error);
    return { ok: false, code: "unknown", issues: [] };
  }
}

export async function shareAction(requestId: string) {
  return result(async () =>
    review.shareReview(db, await getActor(), id.parse(requestId)),
  );
}

/** HR: shares every submitted manager review of the cycle. */
export async function shareAllAction(
  cycleId: string,
): Promise<ActionResult<{ count: number }>> {
  let count = 0;
  const res = await result(async () => {
    count = await review.shareAll(db, await getActor(), id.parse(cycleId));
  });
  return res.ok ? { ok: true, count } : res;
}

export async function remindAction(requestId: string) {
  return result(async () =>
    review.sendReminder(db, await getActor(), id.parse(requestId)),
  );
}
