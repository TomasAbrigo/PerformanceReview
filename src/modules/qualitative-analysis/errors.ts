import { DomainError } from "@/lib/domain-error";

export type AnalysisErrorCode =
  | "forbidden"
  | "not_found"
  | "not_labeled"
  | "validation"
  | "missing_api_key"
  | "unknown_provider"
  | "provider_failed"
  | "invalid_csv";

export class AnalysisError extends DomainError<AnalysisErrorCode> {}
