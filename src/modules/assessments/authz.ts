// Drizzle- and server-free: shared by the queries and the screens.
import { individualScope } from "@/modules/actor/individual-scope";
import type { ActorContext } from "@/modules/actor/types";

/**
 * Whether `actor` may open a participant's assessment page: People any,
 * a manager their snapshot reports' (and their own), an employee only their
 * own, direction none. Opening is only the first gate: what is read inside
 * goes through the review module's `canRead`, request by request.
 */
export function canOpenParticipant(
  actor: ActorContext,
  participant: {
    revieweePersonId: string;
    snapManagerPersonId: string | null;
  },
): boolean {
  const scope = individualScope(actor);
  switch (scope.kind) {
    case "all":
      return true;
    case "team":
      return (
        participant.revieweePersonId === scope.personId ||
        participant.snapManagerPersonId === scope.personId
      );
    case "own":
      return participant.revieweePersonId === scope.personId;
    case "none":
      return false;
  }
}
