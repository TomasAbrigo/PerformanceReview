import { DomainError } from "@/lib/domain-error";

export type ReviewErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "missing_required"
  | "not_submitted"
  | "nominations_full"
  | "invalid_nominee"
  | "already_nominated"
  | "wrong_phase"
  | "no_approval"
  | "not_shareable"
  | "not_remindable"
  | "reason_required"
  | "shared";

/** Errors of review requests and answers (issues: per-question paths). */
export class ReviewError extends DomainError<ReviewErrorCode> {}
