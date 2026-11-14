import { DomainError } from "@/lib/domain-error";

export type ReviewErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "missing_required"
  | "not_submitted"
  | "not_shareable"
  | "not_remindable";

/** Errors of review requests and answers (issues: per-question paths). */
export class ReviewError extends DomainError<ReviewErrorCode> {}
