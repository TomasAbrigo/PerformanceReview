"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import * as cycles from "@/modules/review-core";
import { cycleStatuses } from "@/modules/review-core/status";

const cycleId = z.uuid();
const isoDate = z.iso.date();

// No authentication yet: transitions are logged without an actor.
const ACTOR: string | null = null;

export async function previewParticipantsAction(
  filter: cycles.ParticipantFilterInput,
  asOf: string,
) {
  return actionResult(() =>
    cycles.previewParticipants(
      db,
      filter,
      10,
      parse(isoDate, asOf, cycles.CyclesError),
    ),
  );
}

export async function createCycleAction(input: cycles.CycleInput) {
  return actionResult(async () => ({
    id: (await cycles.createCycle(db, input)).id,
  }));
}

export async function launchCycleAction(id: string) {
  return actionResult(
    async () => {
      await cycles.launchCycle(
        db,
        parse(cycleId, id, cycles.CyclesError),
        ACTOR,
      );
    },
    { refreshPage: true },
  );
}

export async function transitionCycleAction(
  id: string,
  to: cycles.CycleStatus,
) {
  return actionResult(
    async () => {
      await cycles.transition(
        db,
        parse(cycleId, id, cycles.CyclesError),
        parse(z.enum(cycleStatuses), to, cycles.CyclesError),
        ACTOR,
      );
    },
    { refreshPage: true },
  );
}
