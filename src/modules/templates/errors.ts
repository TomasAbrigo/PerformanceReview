import { DomainError, type FieldIssue } from "@/lib/domain-error";

export type TemplatesErrorCode =
  "validation" | "not_found" | "system_readonly" | "in_use";

export type { FieldIssue };

export class TemplatesError extends DomainError<TemplatesErrorCode> {}
