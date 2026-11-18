// Drizzle- and server-free: shared by the queries, the pages and the navigation.
import type { ActorContext } from "./types";

/**
 * Whose goals and assessments (the individual screens, not the analysis) an
 * actor may open:
 * - `all`: People, everybody;
 * - `team`: a manager, their direct reports and themself;
 * - `own`: an employee, only themself;
 * - `none`: direction (aggregates only, see modules/insights/authz) and a
 *   manager or employee acting without a person.
 * What they read inside is decided per row (the review visibility rules for
 * answers); this only says whose rows they may list.
 */
export type IndividualScope =
  | { kind: "all" }
  | { kind: "team"; personId: string }
  | { kind: "own"; personId: string }
  | { kind: "none" };

export function individualScope(actor: ActorContext): IndividualScope {
  switch (actor.role) {
    case "hr":
      return { kind: "all" };
    case "manager":
      return actor.personId
        ? { kind: "team", personId: actor.personId }
        : { kind: "none" };
    case "employee":
      return actor.personId
        ? { kind: "own", personId: actor.personId }
        : { kind: "none" };
    case "direction":
      return { kind: "none" };
  }
}

/** Whether the actor has any individual goal or assessment to browse. */
export const canBrowseIndividuals = (actor: ActorContext): boolean =>
  individualScope(actor).kind !== "none";
