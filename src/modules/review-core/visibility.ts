import type { ActorContext } from "@/modules/actor/types";
import type { Relationship } from "@/modules/templates/constants";
import type { RequestStatus } from "./request-status";
import { type CycleComponents, isDoubleBlind } from "./status";

/** The request fields visibility depends on. */
export type VisibilityRequest = {
  relationship: Relationship;
  /** Null when the reviewer is missing (no manager at the snapshot). */
  reviewerPersonId: string | null;
  status: RequestStatus;
  /** Manager review shared with the reviewee. */
  sharedAt?: Date | null;
};

export type VisibilityContext = {
  request: VisibilityRequest;
  participant: {
    revieweePersonId: string;
    snapManagerPersonId?: string | null;
  };
  /** Cycle settings (double blind, anonymity) used by the reading rules. */
  cycle?: {
    status: string;
    components?: Pick<CycleComponents, "doubleBlind">;
  };
  /** Self rows: the participant's manager request (double blind). */
  managerRequest?: { status: RequestStatus } | null;
  /** The actor manages the participant's snapshot manager (see isSkipLevel). */
  skipLevel?: boolean;
  /** Reading one answer: its question's per-question rules. */
  questionRevision?: { visibleToReviewee: boolean };
};

const isReviewer = (actor: ActorContext, r: VisibilityRequest) =>
  actor.personId !== null && actor.personId === r.reviewerPersonId;

const isManagerOf = (actor: ActorContext, ctx: VisibilityContext) =>
  actor.personId !== null &&
  actor.personId === ctx.participant.snapManagerPersonId;

const isReviewee = (actor: ActorContext, ctx: VisibilityContext) =>
  actor.personId !== null &&
  actor.personId === ctx.participant.revieweePersonId;

/**
 * The single place that decides whether `actor` may read a review request
 * (and, with `questionRevision`, one of its answers). HR (People) reads
 * everything; the author reads their own request. Then:
 * - self: the snapshot manager reads it once submitted; under double blind
 *   only after submitting their own manager review;
 * - manager: the snapshot manager reads it; the reviewee only once shared
 *   and only the questions visible to the reviewee;
 * - skip-level managers read submitted self/manager reviews (read-only);
 * - peer/upward: #14 (aggregated/anonymized views).
 */
export function canRead(actor: ActorContext, ctx: VisibilityContext): boolean {
  if (actor.role === "hr") return true;
  const { request } = ctx;
  if (isReviewer(actor, request)) return true;
  const submitted = request.status === "submitted";
  switch (request.relationship) {
    case "self":
      if (!submitted || actor.personId === null) return false;
      if (ctx.skipLevel) return true;
      if (!isManagerOf(actor, ctx)) return false;
      return (
        !isDoubleBlind(ctx.cycle?.components ?? {}) ||
        ctx.managerRequest?.status === "submitted"
      );
    case "manager":
      if (isManagerOf(actor, ctx)) return true;
      if (submitted && ctx.skipLevel && actor.personId !== null) return true;
      if (isReviewee(actor, ctx)) {
        return (
          submitted &&
          !!request.sharedAt &&
          ctx.questionRevision?.visibleToReviewee !== false
        );
      }
      return false;
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
