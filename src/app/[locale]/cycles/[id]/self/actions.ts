"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();
const answers = z.array(
  z.object({
    questionRevisionId: z.uuid(),
    value: z.union([z.string(), z.number(), z.null()]),
  }),
);
const note = z.string().max(2000).nullable();

/** Autosave: no refresh, the form keeps its local state. */
export async function saveDraftAction(
  requestId: string,
  input: review.AnswerInput[],
) {
  return actionResult(async () => {
    await review.saveDraft(
      db,
      await getActor(),
      parse(id, requestId, review.ReviewError),
      parse(answers, input, review.ReviewError),
    );
  });
}

export async function submitAction(requestId: string) {
  return actionResult(
    async () => {
      await review.submit(
        db,
        await getActor(),
        parse(id, requestId, review.ReviewError),
      );
    },
    { refreshPage: true },
  );
}

export async function unlockAction(
  requestId: string,
  unlockNote: string | null,
) {
  return actionResult(
    async () => {
      await review.unlock(
        db,
        await getActor(),
        parse(id, requestId, review.ReviewError),
        parse(note, unlockNote, review.ReviewError),
      );
    },
    { refreshPage: true },
  );
}
