"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import type { AnswerInput } from "@/modules/review-core/answers";
import * as ops from "@/modules/review-core/ops";
import {
  type AssessorMode,
  assessorModes,
} from "@/modules/review-core/ops-constants";
import { OpsError } from "@/modules/review-core/ops-errors";
import { type DueDatePhase, dueDatePhases } from "@/modules/review-core/status";

// Administrative operations on a cycle (#17). The domain checks that the actor
// is HR and writes the audit row in the same transaction.

const id = z.uuid();
const note = z.string().max(2000).nullable();
const date = z.iso.date();
const phase = z.enum(dueDatePhases);
const mode = z.enum(assessorModes);
const answers = z.array(
  z.object({
    questionRevisionId: z.uuid(),
    value: z.union([z.string(), z.number(), z.null()]),
  }),
);

const check = <T>(schema: z.ZodType<T>, value: unknown) =>
  parse(schema, value, OpsError);

export async function addParticipantAction(
  cycleId: string,
  personId: string,
  reason: string | null,
) {
  return actionResult(async () => {
    await ops.addParticipantOp(
      db,
      await getActor(),
      check(id, cycleId),
      check(id, personId),
      { note: check(note, reason) },
    );
  });
}

export async function removeParticipantAction(
  cycleId: string,
  personId: string,
  reason: string | null,
) {
  return actionResult(async () => {
    await ops.removeParticipantOp(
      db,
      await getActor(),
      check(id, cycleId),
      check(id, personId),
      { note: check(note, reason) },
    );
  });
}

export async function assignAssessorAction(
  participantId: string,
  personId: string,
  assessorMode: AssessorMode,
  reason: string | null,
) {
  return actionResult(async () => {
    await ops.assignAlternateAssessor(
      db,
      await getActor(),
      check(id, participantId),
      check(id, personId),
      check(mode, assessorMode),
      { note: check(note, reason) },
    );
  });
}

export async function unlockRequestAction(
  requestId: string,
  reason: string | null,
) {
  return actionResult(async () => {
    await ops.unlockRequestOp(
      db,
      await getActor(),
      check(id, requestId),
      check(note, reason),
    );
  });
}

export async function completeOnBehalfAction(
  requestId: string,
  input: AnswerInput[],
  reason: string | null,
) {
  return actionResult(async () => {
    await ops.completeOnBehalf(
      db,
      await getActor(),
      check(id, requestId),
      check(answers, input),
      { note: check(note, reason) },
    );
  });
}

export async function extendDueDateAction(
  cycleId: string,
  duePhase: DueDatePhase,
  newDate: string,
  reason: string | null,
) {
  return actionResult(async () => {
    await ops.extendDueDate(
      db,
      await getActor(),
      check(id, cycleId),
      check(phase, duePhase),
      check(date, newDate),
      { note: check(note, reason) },
    );
  });
}
