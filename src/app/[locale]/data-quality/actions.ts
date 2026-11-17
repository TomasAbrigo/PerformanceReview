"use server";

import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { DomainError } from "@/lib/domain-error";
import { getActor } from "@/modules/actor/server";
import { reapplyLikertMappings } from "@/modules/import-history/likert-reapply";

/** "Reaplicar equivalencias": People only. */
export async function reapplyLikertAction() {
  return actionResult(async () => {
    const actor = await getActor();
    if (actor.role !== "hr") throw new DomainError("forbidden");
    const { remapped, resolved } = await reapplyLikertMappings(db);
    return { remapped, resolved };
  });
}
