"use server";

import { z } from "zod";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { parse } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import * as notifications from "@/modules/notifications";

const ids = z.array(z.uuid()).max(200);

/** Marks the acting person's own notifications read (others' are ignored). */
export async function markReadAction(notificationIds: string[]) {
  return actionResult(async () => {
    await notifications.markRead(
      db,
      await getActor(),
      parse(ids, notificationIds, notifications.NotificationError),
    );
  });
}

export async function markAllReadAction() {
  return actionResult(async () => {
    await notifications.markAllRead(db, await getActor());
  });
}
