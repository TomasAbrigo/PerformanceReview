// Drizzle- and server-free: shared by services, server actions and pages.
import { DomainError } from "@/lib/domain-error";
import type { ActorContext } from "./types";

/** The actor may not do this (there is no login yet: the actor is the role). */
export class ForbiddenError extends DomainError<"forbidden"> {}

export const isHr = (actor: ActorContext) => actor.role === "hr";

/** Throws unless the actor is People (hr): imports, data quality, settings. */
export function requireHr(actor: ActorContext): void {
  if (!isHr(actor)) throw new ForbiddenError("forbidden");
}
