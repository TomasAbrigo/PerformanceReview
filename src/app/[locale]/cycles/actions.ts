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
  return actionResult(
    () =>
      cycles.previewParticipants(
        db,
        filter,
        10,
        parse(isoDate, asOf, cycles.CyclesError),
      ),
    undefined,
    { refreshPage: false },
  );
}

export async function previewGroupsAction(
  filter: cycles.ParticipantFilterInput,
  groups: { filter: cycles.ParticipantFilterInput }[],
  asOf: string,
) {
  return actionResult(
    () =>
      cycles.previewGroups(
        db,
        filter,
        groups,
        parse(isoDate, asOf, cycles.CyclesError),
      ),
    undefined,
    { refreshPage: false },
  );
}

/** Creates the draft and its template groups together (or neither). */
export async function createCycleAction(
  input: cycles.CycleInput,
  groups: cycles.CycleGroupInput[] = [],
) {
  return actionResult(
    async () => ({
      id: (
        await db.transaction(async (tx) => {
          const cycle = await cycles.createCycle(tx, input);
          if (groups.length > 0) {
            await cycles.setCycleGroups(tx, cycle.id, groups);
          }
          return cycle;
        })
      ).id,
    }),
    undefined,
    { refreshPage: false },
  );
}

export async function duplicateCycleAction(id: string, suffix: string) {
  return actionResult(
    async () => {
      // The suffix is the UI's translated word: the server only requires one.
      const { cycle, warnings } = await cycles.duplicateCycle(
        db,
        ACTOR,
        parse(cycleId, id, cycles.CyclesError),
        { suffix },
      );
      return { id: cycle.id, warnings };
    },
    undefined,
    { refreshPage: false },
  );
}

export async function launchCycleAction(id: string) {
  return actionResult(async () => {
    await cycles.launchCycle(db, parse(cycleId, id, cycles.CyclesError), ACTOR);
  });
}

export async function transitionCycleAction(
  id: string,
  to: cycles.CycleStatus,
) {
  return actionResult(async () => {
    await cycles.transition(
      db,
      parse(cycleId, id, cycles.CyclesError),
      parse(z.enum(cycleStatuses), to, cycles.CyclesError),
      ACTOR,
    );
  });
}
