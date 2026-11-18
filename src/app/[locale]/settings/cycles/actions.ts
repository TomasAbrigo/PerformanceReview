"use server";

import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { getActor, onlyHr } from "@/modules/actor/server";
import {
  addParticipant,
  closeCycle,
  createCycle,
  launchCycle,
  removeParticipant,
  reopenRequest,
  setParticipants,
} from "@/modules/review-core";

// People only: each action checks it (`onlyHr`) before running and the
// service checks it again. Anything else comes back as `forbidden`.

export async function createCycleAction(input: {
  name: string;
  periodStart: string;
  periodEnd: string;
}) {
  return onlyHr(async () => {
    const actor = await getActor();
    return actionResult(async () => ({
      id: (await createCycle(db, actor, input)).id,
    }));
  });
}

export async function setParticipantsAction(
  cycleId: string,
  personIds: string[],
) {
  return onlyHr(async () => {
    const actor = await getActor();
    return actionResult(() => setParticipants(db, actor, cycleId, personIds));
  });
}

export async function launchCycleAction(cycleId: string) {
  return onlyHr(async () => {
    const actor = await getActor();
    return actionResult(async () => {
      await launchCycle(db, actor, cycleId);
    });
  });
}

export async function closeCycleAction(cycleId: string) {
  return onlyHr(async () => {
    const actor = await getActor();
    return actionResult(async () => {
      await closeCycle(db, actor, cycleId);
    });
  });
}

export async function addParticipantAction(cycleId: string, personId: string) {
  return onlyHr(async () => {
    const actor = await getActor();
    return actionResult(() => addParticipant(db, actor, cycleId, personId));
  });
}

export async function removeParticipantAction(
  cycleId: string,
  personId: string,
) {
  return onlyHr(async () => {
    const actor = await getActor();
    return actionResult(() => removeParticipant(db, actor, cycleId, personId));
  });
}

export async function reopenRequestAction(requestId: string) {
  return onlyHr(async () => {
    const actor = await getActor();
    return actionResult(async () => {
      await reopenRequest(db, actor, requestId);
    });
  });
}
