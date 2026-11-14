"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();
const ids = z.array(z.uuid()).min(1).max(200);
const decision = z.enum(["approved", "declined"]);
const reason = z.string().max(2000);

export async function nominateAction(participantId: string, personId: string) {
  return actionResult(async () => {
    await review.nominatePeer(
      db,
      await getActor(),
      parse(id, participantId, review.ReviewError),
      parse(id, personId, review.ReviewError),
    );
  });
}

export async function removeNominationAction(nominationId: string) {
  return actionResult(async () => {
    await review.removeNomination(
      db,
      await getActor(),
      parse(id, nominationId, review.ReviewError),
    );
  });
}

export async function decideNominationsAction(
  nominationIds: string[],
  to: "approved" | "declined",
) {
  return actionResult(async () => {
    await review.decideNominations(
      db,
      await getActor(),
      parse(ids, nominationIds, review.ReviewError),
      parse(decision, to, review.ReviewError),
    );
  });
}

export async function declineRequestAction(requestId: string, text: string) {
  return actionResult(async () => {
    await review.declineRequest(
      db,
      await getActor(),
      parse(id, requestId, review.ReviewError),
      parse(reason, text, review.ReviewError),
    );
  });
}
