// Drizzle- and server-free: shared by the write functions and the screens.
import type { ActorContext } from "@/modules/actor/types";

/**
 * The one rule of who may create or change a goal (and its milestones and
 * status): its owner, the owner's current manager, or People. Direction never
 * (it reads aggregates only). `isCurrentManager` says whether the actor is
 * the owner's manager today; it only counts for the manager role.
 */
export function canEditGoal(
  actor: ActorContext,
  goal: { personId: string },
  { isCurrentManager }: { isCurrentManager: boolean },
): boolean {
  switch (actor.role) {
    case "hr":
      return true;
    case "manager":
      return (
        actor.personId !== null &&
        (actor.personId === goal.personId || isCurrentManager)
      );
    case "employee":
      return actor.personId !== null && actor.personId === goal.personId;
    case "direction":
      return false;
  }
}
