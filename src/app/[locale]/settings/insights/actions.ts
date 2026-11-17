"use server";

import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { getActor, onlyHr } from "@/modules/actor/server";
import { updateSettings } from "@/modules/settings";

/**
 * Saves the insights settings (People only; the service checks it again and
 * writes the audit log). The values come from a form: the service validates
 * every one, so a bad one comes back as field issues, never as a crash.
 */
export async function updateInsightsSettingsAction(
  values: Record<string, unknown>,
) {
  return onlyHr(async () => {
    const actor = await getActor();
    return actionResult(async () => ({
      changed: await updateSettings(db, actor, values),
    }));
  });
}
