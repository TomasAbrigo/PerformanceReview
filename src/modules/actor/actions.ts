"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import type { ActionResult } from "@/lib/action-result";
import { personExists } from "./queries";
import { ACTOR_COOKIE, type ActorRole, actorSchema } from "./types";

/** Sets who the app acts as (httpOnly cookie) and refreshes the page. */
export async function setActorAction(
  personId: string | null,
  role: ActorRole,
): Promise<ActionResult> {
  const parsed = actorSchema.safeParse({ personId, role });
  if (!parsed.success) return { ok: false, code: "validation", issues: [] };
  if (parsed.data.personId && !(await personExists(db, parsed.data.personId))) {
    return { ok: false, code: "not_found", issues: [] };
  }
  (await cookies()).set(ACTOR_COOKIE, JSON.stringify(parsed.data), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  refresh();
  return { ok: true };
}
