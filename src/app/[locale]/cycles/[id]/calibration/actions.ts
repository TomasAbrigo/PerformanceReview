"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { NewGroupInput } from "@/components/calibration/groups-panel";
import type { ProposeInput } from "@/components/calibration/calibration-table";
import { db } from "@/db/client";
import { cycleParticipant } from "@/db/schema";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import * as review from "@/modules/review-core";

const id = z.uuid();
const proposeSchema = z.object({
  participantId: z.uuid(),
  value: z.number(),
  reason: z.string().max(2000),
  flag: z.boolean(),
});
const groupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(review.calibrationGroupKinds),
  criterion: z.string().max(200),
});

export async function proposeAction(input: ProposeInput) {
  return actionResult(async () => {
    const data = parse(proposeSchema, input, review.ReviewError);
    await review.proposeRating(db, await getActor(), data.participantId, data);
  });
}

/** Manual groups from the UI include every active participant. */
export async function createGroupAction(cycleId: string, input: NewGroupInput) {
  return actionResult(async () => {
    const cid = parse(id, cycleId, review.ReviewError);
    const data = parse(groupSchema, input, review.ReviewError);
    const actor = await getActor();
    const group: review.GroupInput =
      data.kind === "by_department"
        ? { name: data.name, kind: data.kind, department: data.criterion }
        : data.kind === "by_manager"
          ? {
              name: data.name,
              kind: data.kind,
              managerPersonId: data.criterion,
            }
          : {
              name: data.name,
              kind: "manual",
              participantIds: (
                await db
                  .select({ id: cycleParticipant.id })
                  .from(cycleParticipant)
                  .where(
                    and(
                      eq(cycleParticipant.cycleId, cid),
                      isNull(cycleParticipant.removedAt),
                    ),
                  )
              ).map((r) => r.id),
            };
    await review.createGroup(db, actor, cid, group);
  });
}

export async function publishAction(cycleId: string) {
  return actionResult(async () => ({
    count: await review.publishCalibration(
      db,
      await getActor(),
      parse(id, cycleId, review.ReviewError),
    ),
  }));
}
