import type { ActorContext } from "@/modules/actor/types";
import type { Relationship } from "@/modules/templates/constants";
import type { RequestStatus } from "./request-status";

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
  cycle?: { status: string };
  /** Per-question rules (visible_to_reviewee) come with #12. */
  questionRevision?: { visibleToReviewee: boolean };
};

const isReviewer = (actor: ActorContext, r: VisibilityRequest) =>
  actor.personId !== null && actor.personId === r.reviewerPersonId;

/**
 * The single place that decides whether `actor` may read a review request
 * (and its answers). HR (People) reads everything; the author reads their
 * own request. Everything else is denied for now:
 * - manager reading the report's self review, the reviewee reading the
 *   manager review after sharing (double blind): #12;
 * - reviewee/manager reading peer and upward reviews (anonymity): #14.
 */
export function canRead(actor: ActorContext, ctx: VisibilityContext): boolean {
  if (actor.role === "hr") return true;
  if (isReviewer(actor, ctx.request)) return true;
  switch (ctx.request.relationship) {
    case "self":
      return false; // #12: the manager reads it once the double blind lifts.
    case "manager":
      return false; // #12: the reviewee reads it once shared.
    case "peer":
    case "upward":
      return false; // #14: aggregated/anonymized views.
  }
}

/** Only the reviewer writes, and only while the request is a draft. */
export function canWrite(
  actor: ActorContext,
  request: VisibilityRequest,
): boolean {
  return isReviewer(actor, request) && request.status === "draft";
}
