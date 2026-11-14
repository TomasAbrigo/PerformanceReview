"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();
// The same limits the domain enforces (one constant each): an over-long note
// is refused here with the same "too_long" the form shows.
const body = z.string().max(review.FOLLOW_UP_MAX_LENGTH);
const note = z.string().max(review.ACK_NOTE_MAX_LENGTH).nullable();

/** The manager (or HR) adds a follow-up note about the participant. */
export async function addFollowUpAction(participantId: string, text: string) {
  return actionResult(async () => {
    await review.addFollowUpNote(
      db,
      await getActor(),
      parse(id, participantId, review.ReviewError),
      parse(body, text, review.ReviewError),
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
