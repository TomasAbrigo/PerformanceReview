import type { ActorContext } from "@/modules/actor/types";
import type { Relationship } from "@/modules/templates/constants";
import type { RequestStatus } from "./request-status";
import type { CycleStatus } from "./status";

/** The request fields visibility depends on. */
export type VisibilityRequest = {
  relationship: Relationship;
  reviewerPersonId: string;
  status: RequestStatus;
};

export type VisibilityContext = {
  request: VisibilityRequest;
  participant: { revieweePersonId: string };
  /** Cycle settings (anonymity, sharing) used by the manager/peer rules. */
  cycle?: { status: CycleStatus };
  /** Per-question rules (visible_to_reviewee) come with #12. */
  questionRevision?: { visibleToReviewee: boolean };
};

/** Where a request lives: the cycle phase and whether the reviewee is still in. */
export type WriteScope = {
  cycle: { status: CycleStatus };
  participant: { removedAt: Date | null };
};

/** Cycle phases in which each kind of review can be written. */
export const writablePhases: Record<Relationship, readonly CycleStatus[]> = {
  self: ["collecting"],
  peer: ["collecting"],
  upward: ["collecting"],
  manager: ["manager_review"],
};

const isReviewer = (actor: ActorContext, r: VisibilityRequest) =>
  actor.personId !== null && actor.personId === r.reviewerPersonId;

/**
 * The single place that decides whether `actor` may read a review request
 * (and its answers): HR (People) reads everything, the author reads their
 * own request, nobody else reads anything yet.
 * TODO(#12): manager reads the report's self review once the double blind
 * lifts; the reviewee reads the manager review once shared.
 * TODO(#14): aggregated/anonymized peer and upward views.
 */
export function canRead(actor: ActorContext, ctx: VisibilityContext): boolean {
  return actor.role === "hr" || isReviewer(actor, ctx.request);
}

/**
 * Only the reviewer writes, only while the request is a draft, the cycle is
 * in a phase where that kind of review is written, and the reviewee is
 * still a participant.
 */
export function canWrite(
  actor: ActorContext,
  request: VisibilityRequest,
  scope: WriteScope,
): boolean {
  return (
    isReviewer(actor, request) &&
    request.status === "draft" &&
    writablePhases[request.relationship].includes(scope.cycle.status) &&
    scope.participant.removedAt === null
  );
}
