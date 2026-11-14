import { DomainError } from "@/lib/domain-error";

export type OpsErrorCode =
  | "forbidden"
  | "validation"
  | "not_found"
  /** A due date may only move forward (and only when the phase has one). */
  | "date_not_forward"
  /** The participant has no manager request yet (cycle not collecting). */
  | "no_manager_request"
  /** The person already is the reviewer of that participant's manager review. */
  | "same_reviewer"
  | "already_assigned"
  /** The participant has no manager: the assessor must take that slot. */
  | "replace_required"
  | "reviewer_missing"
  | "not_draft"
  /** The reviewer could not write it now (phase, removed participant). */
  | "not_writable";

/** Errors of the administrative operations on a cycle (#17). */
export class OpsError extends DomainError<OpsErrorCode> {}
