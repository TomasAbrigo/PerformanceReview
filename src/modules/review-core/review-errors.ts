import { DomainError } from "@/lib/domain-error";

export type ReviewErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  /** The cycle or request is not in a state that allows it (closed, draft...). */
  | "invalid_state";

/** Errors of reading review data (cycles, requests, answers, dashboards). */
export class ReviewError extends DomainError<ReviewErrorCode> {}
