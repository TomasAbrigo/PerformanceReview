"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import {
  CaptureError,
  saveDraft,
  share,
  submit,
  type CaptureAnswer,
} from "@/modules/review-capture";

const answersSchema = z
  .array(
    z.object({
      questionRevisionId: z.string().max(64),
      value: z.union([z.string().max(20_000), z.number(), z.null()]),
    }),
  )
  .max(200);

/**
 * Saves the answers of a request as a draft. Who may write it (its reviewer
 * or People), the cycle being open and every answer are checked by
 * review-capture, never here.
 */
export async function saveDraftAction(
  requestId: string,
  answers: CaptureAnswer[],
) {
  return actionResult(async () => {
    const actor = await getActor();
    await saveDraft(
      db,
      actor,
      String(requestId),
      parse(answersSchema, answers, CaptureError),
    );
  });
}

/**
 * Shares a submitted manager review with the reviewee. Only its reviewer (or
 * People) may, and only once submitted: review-capture checks both.
 */
export async function shareAction(requestId: string) {
  return actionResult(async () => {
    await share(db, await getActor(), String(requestId));
  });
}

/** Saves the answers and submits the request (read-only from then). */
export async function submitAction(
  requestId: string,
  answers: CaptureAnswer[],
) {
  return actionResult(async () => {
    const actor = await getActor();
    const id = String(requestId);
    await saveDraft(db, actor, id, parse(answersSchema, answers, CaptureError));
    await submit(db, actor, id);
  });
}
