import type { ActorContext } from "@/modules/actor/types";
import type { Relationship } from "@/modules/templates/constants";
import type { RequestStatus } from "./request-status";
import {
  type CycleAnonymity,
  type CycleComponents,
  type CycleStatus,
  isDoubleBlind,
} from "./status";

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
    /** Removed reviewees read nothing of their cycle (see isActiveParticipant). */
    removedAt?: Date | null;
  };
  /** Cycle settings (double blind, anonymity) used by the reading rules. */
  cycle?: {
    status: CycleStatus;
    components?: Pick<CycleComponents, "doubleBlind">;
    /** Peer/upward anonymity modes (#14). */
    anonymity?: CycleAnonymity;
  };
  /**
   * Peer/upward rows: whether the feedback is released to the reviewee
   * (see peerFeedbackShared: sharing/closed phase and, with manager
   * reviews, their manager review shared). Before that the reviewee never
   * reads peer/upward feedback.
   */
  revieweeShared?: boolean;
  /**
   * Self rows: the participant's current manager request (the actor's own
   * if they wrote one; superseded ones never count), which gates the double
   * blind. Its
   * shared_at tells whether the manager review reached the employee (the
   * current manager reads the self review from then).
   */
  managerRequest?: { status: RequestStatus; sharedAt?: Date | null } | null;
  /** The actor manages the participant's snapshot manager (see isSkipLevel). */
  skipLevel?: boolean;
  /**
   * The actor is the reviewee's manager today (see isCurrentManager), who
   * follows their trajectory even in cycles someone else managed.
   */
  currentManager?: boolean;
  /** Reading one answer: its question's per-question rules. */
  questionRevision?: { visibleToReviewee: boolean };
};

/** A participant still in the cycle (not removed mid-cycle). */
export const isActiveParticipant = (p: { removedAt?: Date | null }) =>
  !p.removedAt;

/** Phases in which reviews count as shared even without shared_at. */
const SHARED_PHASES: readonly CycleStatus[] = ["sharing", "closed"];

/** The actor is that person (never true for a person-less actor). */
export const isActorPerson = (
  actor: ActorContext,
  personId: string | null | undefined,
) => actor.personId !== null && actor.personId === personId;

export const isReviewer = (actor: ActorContext, r: VisibilityRequest) =>
  isActorPerson(actor, r.reviewerPersonId);

const isManagerOf = (actor: ActorContext, ctx: VisibilityContext) =>
  isActorPerson(actor, ctx.participant.snapManagerPersonId);

const isReviewee = (actor: ActorContext, ctx: VisibilityContext) =>
  isActorPerson(actor, ctx.participant.revieweePersonId);

/**
 * The single place that decides whether `actor` may read a review request
 * (and, with `questionRevision`, one of its answers). Roles: hr, manager,
 * employee. HR (People) reads everything; the author reads their own request
 * (a manager or employee acting as that person). Then:
 * - self: the snapshot manager reads it once submitted; under double blind
 *   only after the manager review is submitted;
 * - manager: the snapshot manager reads it; the reviewee only once shared
 *   and only the questions visible to the reviewee;
 * - skip-level managers read submitted self reviews, and submitted manager
 *   reviews once shared (shared_at, or the cycle is sharing/closed), so
 *   they never see a pre-calibration rating;
 * - the reviewee's current manager reads what was shared with the employee
 *   (a shared manager review; the self review once that one is shared);
 * - nobody but HR and the author reads requests of a removed participant;
 * - peer/upward: the snapshot manager (and HR) read them once submitted;
 *   the reviewee only once shared (see revieweeShared), and only the
 *   questions visible to them. Who wrote it: reviewerVisible.
 */
export function canRead(actor: ActorContext, ctx: VisibilityContext): boolean {
  if (actor.role === "hr") return true;
  const { request } = ctx;
  if (isReviewer(actor, request)) return true;
  if (actor.personId === null || !isActiveParticipant(ctx.participant)) {
    return false;
  }
  const submitted = request.status === "submitted";
  switch (request.relationship) {
    case "self":
      if (!submitted) return false;
      if (ctx.skipLevel) return true;
      if (ctx.currentManager && ctx.managerRequest?.sharedAt) return true;
      if (!isManagerOf(actor, ctx)) return false;
      return (
        !isDoubleBlind(ctx.cycle?.components ?? {}) ||
        ctx.managerRequest?.status === "submitted"
      );
    case "manager":
      if (isManagerOf(actor, ctx)) return true;
      if (!submitted) return false;
      if (isReviewee(actor, ctx)) {
        return (
          !!request.sharedAt &&
          ctx.questionRevision?.visibleToReviewee !== false
        );
      }
      return (
        (!!ctx.skipLevel &&
          (!!request.sharedAt ||
            SHARED_PHASES.includes(ctx.cycle?.status ?? "draft"))) ||
        (!!ctx.currentManager && !!request.sharedAt)
      );
    case "peer":
    case "upward":
      if (!submitted) return false;
      if (isManagerOf(actor, ctx)) return true;
      if (isReviewee(actor, ctx)) {
        return (
          !!ctx.revieweeShared &&
          ctx.questionRevision?.visibleToReviewee !== false
        );
      }
      return false;
  }
}

/**
 * Whether `actor` may see who wrote a readable request. Peer/upward follow
 * the cycle's anonymity mode: transparent shows names to everyone who reads;
 * anonymous_to_employee hides them from the reviewee ("Par"); fully
 * anonymous hides them from everyone but the author (HR included; the
 * reviewer stays stored in the DB).
 */
export function reviewerVisible(
  actor: ActorContext,
  ctx: VisibilityContext,
  options: {
    /**
     * Treat the author like anybody else (no "you wrote it" shortcut): for
     * readers that must never tell a fully anonymous reviewer, whoever asks.
     */
    hideFromAuthor?: boolean;
  } = {},
): boolean {
  const { relationship } = ctx.request;
  if (relationship !== "peer" && relationship !== "upward") return true;
  if (!options.hideFromAuthor && isReviewer(actor, ctx.request)) return true;
  const mode = ctx.cycle?.anonymity?.[relationship] ?? "fully_anonymous";
  if (mode === "transparent") return true;
  if (mode === "fully_anonymous") return false;
  return !isReviewee(actor, ctx);
}
