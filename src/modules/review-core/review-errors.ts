import { DomainError } from "@/lib/domain-error";

export type ReviewErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "missing_required"
  | "not_submitted"
  | "reason_required"
  | "shared";

/** Errors of review requests and answers (issues: per-question paths). */
export class ReviewError extends DomainError<ReviewErrorCode> {}
