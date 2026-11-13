import { DomainError } from "@/lib/domain-error";

export type CyclesErrorCode =
  | "validation"
  | "not_found"
  | "not_draft"
  | "not_active"
  | "invalid_transition"
  | "no_participants"
  | "no_template"
  | "already_participant";

export class CyclesError extends DomainError<CyclesErrorCode> {}
