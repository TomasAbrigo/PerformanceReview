import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  actorRoles,
  DEFAULT_ACTOR,
  type ActorContext,
  type ActorRole,
} from "@/modules/actor/types";
import { notFound } from "./errors";
import { uuid } from "./params";
import { personExists } from "./queries/people";

/**
 * Whose eyes the review endpoints (requests, answers, their CSV exports) read
 * with. The API has no session and no actor: it is an integration surface
 * (lake, analytics), so by default it reads as HR (`scope=hr`: every request
 * and answer, anonymity rules aside). `as_person=<person id>&role=<role>`
 * reads as that person instead, through the same `canRead` the screens use:
 * for debugging and to check parity with what a person sees, not for
 * production use.
 */
export const scopeFields = {
  scope: z.enum(["hr"]).optional(),
  as_person: uuid.optional(),
  role: z.enum(actorRoles).optional(),
};

export type ScopeQuery = {
  scope?: "hr";
  as_person?: string;
  role?: ActorRole;
};

/** `role` needs `as_person`, and an explicit `scope` excludes it. */
export function checkScope(query: ScopeQuery, ctx: z.RefinementCtx): void {
  if (query.role && !query.as_person) {
    ctx.addIssue({
      code: "custom",
      path: ["role"],
      message: "only together with as_person",
    });
  }
  if (query.scope && query.as_person) {
    ctx.addIssue({
      code: "custom",
      path: ["scope"],
      message: "cannot be combined with as_person",
    });
  }
}

/** The query as a standalone schema (endpoints that take no other parameter). */
export const scopeQuery = z.object(scopeFields).superRefine(checkScope);

/** The actor the request reads as: HR by default, else the person (404 if unknown). */
export async function scopeActor(
  db: DbOrTx,
  query: ScopeQuery,
): Promise<ActorContext> {
  if (!query.as_person) return DEFAULT_ACTOR;
  if (!(await personExists(db, query.as_person))) throw notFound("Person");
  return { personId: query.as_person, role: query.role ?? "employee" };
}
