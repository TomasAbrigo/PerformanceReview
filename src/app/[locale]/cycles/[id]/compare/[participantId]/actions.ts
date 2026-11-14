"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();
const text = z.string().max(20_000);
const note = z.string().max(20_000).nullable();

/** The manager (or HR) adds a follow-up note about the participant. */
export async function addFollowUpAction(participantId: string, body: string) {
  return actionResult(async () => {
    await review.addFollowUpNote(
      db,
      await getActor(),
      parse(id, participantId, review.ReviewError),
      parse(text, body, review.ReviewError),
    );
  });
}

/** The employee acknowledges their shared manager review. */
export async function acknowledgeAction(
  participantId: string,
  ackNote: string | null,
) {
  return actionResult(async () => {
    await review.acknowledge(
      db,
      await getActor(),
      parse(id, participantId, review.ReviewError),
      parse(note, ackNote, review.ReviewError),
    );
  });
}
