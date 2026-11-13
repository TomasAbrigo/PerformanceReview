"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/templates/shared";
import { db } from "@/db/client";
import * as cycles from "@/modules/review-core";
import { cycleStatuses } from "@/modules/review-core/status";

const id = z.uuid();

async function result<T extends object = object>(
  fn: () => Promise<T | void>,
  { refreshPage = true } = {},
): Promise<ActionResult<T>> {
  try {
    const value = (await fn()) ?? ({} as T);
    if (refreshPage) refresh();
    return { ok: true, ...value };
  } catch (error) {
    if (error instanceof cycles.CyclesError) {
      return { ok: false, code: error.code, issues: error.issues };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, code: "validation", issues: [] };
    }
    console.error(error);
    return { ok: false, code: "unknown", issues: [] };
  }
}

// No authentication yet: transitions are logged without an actor.
const ACTOR: string | null = null;

export async function previewParticipantsAction(
  filter: cycles.ParticipantFilterInput,
) {
  return result(() => cycles.previewParticipants(db, filter), {
    refreshPage: false,
  });
}

export async function createCycleAction(input: cycles.CycleInput) {
  return result(
    async () => ({ id: (await cycles.createCycle(db, input)).id }),
    {
      refreshPage: false,
    },
  );
}

export async function launchCycleAction(cycleId: string) {
  return result(async () => {
    await cycles.launchCycle(db, id.parse(cycleId), ACTOR);
  });
}

export async function transitionCycleAction(
  cycleId: string,
  to: cycles.CycleStatus,
) {
  return result(async () => {
    await cycles.transition(
      db,
      id.parse(cycleId),
      z.enum(cycleStatuses).parse(to),
      ACTOR,
    );
  });
}
