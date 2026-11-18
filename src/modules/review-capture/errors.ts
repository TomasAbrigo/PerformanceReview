import { DomainError } from "@/lib/domain-error";

export type CaptureErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "cycle_closed"
  | "not_editable"
  | "not_submitted"
  | "not_shareable";

/** Errors of writing a review (answers, submit, share). */
export class CaptureError extends DomainError<CaptureErrorCode> {}
