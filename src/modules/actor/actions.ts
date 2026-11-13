"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import type { ActionResult } from "@/components/templates/shared";
import { ACTOR_COOKIE, type ActorRole, actorSchema } from "./types";

/** Sets who the app acts as (httpOnly cookie) and refreshes the page. */
export async function setActorAction(
  personId: string | null,
  role: ActorRole,
): Promise<ActionResult> {
  const parsed = actorSchema.safeParse({ personId, role });
  if (!parsed.success) return { ok: false, code: "validation", issues: [] };
  (await cookies()).set(ACTOR_COOKIE, JSON.stringify(parsed.data), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  refresh();
  return { ok: true };
}
