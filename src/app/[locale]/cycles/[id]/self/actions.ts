"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/templates/shared";
import { db } from "@/db/client";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();
const answers = z.array(
  z.object({
    questionRevisionId: z.uuid(),
    value: z.union([z.string(), z.number(), z.null()]),
  }),
);

async function result(
  fn: () => Promise<unknown>,
  { refreshPage = true } = {},
): Promise<ActionResult> {
  try {
    await fn();
    if (refreshPage) refresh();
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

/** Autosave: no refresh, the form keeps its local state. */
export async function saveDraftAction(
  requestId: string,
  input: review.AnswerInput[],
) {
  return result(
    async () =>
      review.saveDraft(
        db,
        await getActor(),
        id.parse(requestId),
        answers.parse(input),
      ),
    { refreshPage: false },
  );
}

export async function submitAction(requestId: string) {
  return result(async () =>
    review.submit(db, await getActor(), id.parse(requestId)),
  );
}

export async function unlockAction(requestId: string, note: string | null) {
  return result(async () =>
    review.unlock(
      db,
      await getActor(),
      id.parse(requestId),
      z.string().max(2000).nullable().parse(note),
    ),
  );
}
