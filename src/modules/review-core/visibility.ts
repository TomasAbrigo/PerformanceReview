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
   * Peer/upward rows: whether the participant's review was shared with the
   * reviewee (their manager request has shared_at). Before that the
   * reviewee never reads peer/upward feedback.
   */
  revieweeShared?: boolean;
  /** Self rows: the participant's manager request (double blind). */
  managerRequest?: { status: RequestStatus } | null;
  /** The actor manages the participant's snapshot manager (see isSkipLevel). */
  skipLevel?: boolean;
  /** Reading one answer: its question's per-question rules. */
  questionRevision?: { visibleToReviewee: boolean };
};

/** A participant still in the cycle (not removed mid-cycle). */
export const isActiveParticipant = (p: { removedAt?: Date | null }) =>
  !p.removedAt;

/** Phases in which reviews count as shared even without shared_at. */
const SHARED_PHASES: readonly CycleStatus[] = ["sharing", "closed"];

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
 * - skip-level managers read submitted self reviews, and submitted manager
 *   reviews once shared (shared_at, or the cycle is sharing/closed), so
 *   they never see a pre-calibration rating;
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
        !!ctx.skipLevel &&
        (!!request.sharedAt ||
          SHARED_PHASES.includes(ctx.cycle?.status ?? "draft"))
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
): boolean {
  const { relationship } = ctx.request;
  if (relationship !== "peer" && relationship !== "upward") return true;
  if (isReviewer(actor, ctx.request)) return true;
  const mode = ctx.cycle?.anonymity?.[relationship] ?? "fully_anonymous";
  if (mode === "transparent") return true;
  if (mode === "fully_anonymous") return false;
  return !isReviewee(actor, ctx);
}

/** Where a request lives: the cycle phase and whether the reviewee is still in. */
export type WriteScope = {
  cycle: { status: CycleStatus };
  participant: { removedAt: Date | null };
};

/**
 * Cycle phases in which each kind of review can be written. Managers write
 * from collecting (PRD): double blind controls reading, not writing.
 */
export const writablePhases: Record<Relationship, readonly CycleStatus[]> = {
  self: ["collecting"],
  peer: ["collecting"],
  upward: ["collecting"],
  manager: ["collecting", "manager_review"],
};

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

/**
 * Who may share a manager review with the reviewee: HR, its reviewer or the
 * participant's snapshot manager, while the participant is active. Whether
 * the cycle allows it right now is shareableNow.
 */
export function canShare(
  actor: ActorContext,
  ctx: {
    request: Pick<VisibilityRequest, "relationship" | "reviewerPersonId">;
    participant: {
      snapManagerPersonId: string | null;
      removedAt: Date | null;
    };
  },
): boolean {
  if (ctx.request.relationship !== "manager") return false;
  if (!isActiveParticipant(ctx.participant)) return false;
  if (actor.role === "hr") return true;
  return (
    actor.personId !== null &&
    (actor.personId === ctx.request.reviewerPersonId ||
      actor.personId === ctx.participant.snapManagerPersonId)
  );
}

/**
 * Manager reviews are shared only in the `sharing` phase and, with
 * calibration on, only once calibration was published (#16 sets it).
 */
export function shareableNow(cycle: {
  status: CycleStatus;
  components: Pick<CycleComponents, "calibration">;
  calibrationPublishedAt: Date | null;
}): boolean {
  return (
    cycle.status === "sharing" &&
    (!cycle.components.calibration || cycle.calibrationPublishedAt !== null)
  );
}
