// Drizzle- and server-free: shared by domain code and client components.
import { z } from "zod";

export const actorRoles = [
  "hr",
  "manager",
  "employee",
  "peer",
  "calibrator",
] as const;
export type ActorRole = (typeof actorRoles)[number];

/**
 * Who the app acts as ("actuar como"; there is no login yet): a person (or
 * none, for HR acting as the People team) and their effective role. Every
 * domain read/write of reviews receives it.
 */
export type ActorContext = { personId: string | null; role: ActorRole };

export const DEFAULT_ACTOR: ActorContext = { personId: null, role: "hr" };

export const actorSchema = z.object({
  personId: z.uuid().nullable(),
  role: z.enum(actorRoles),
});

export const ACTOR_COOKIE = "pr_actor";

/** Parses the cookie value; anything invalid falls back to the default. */
export function parseActor(raw: string | undefined | null): ActorContext {
  if (!raw) return DEFAULT_ACTOR;
  try {
    const parsed = actorSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_ACTOR;
  } catch {
    return DEFAULT_ACTOR;
  }
}
