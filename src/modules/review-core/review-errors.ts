import type { FieldIssue } from "@/modules/templates/errors";

export type ReviewErrorCode =
  | "not_found"
  | "forbidden"
  | "validation"
  | "missing_required"
  | "not_submitted";

/** Errors of review requests and answers (issues: per-question paths). */
export class ReviewError extends Error {
  constructor(
    readonly code: ReviewErrorCode,
    readonly issues: FieldIssue[] = [],
  ) {
    super(
      issues.length ? `${code}: ${issues.map((i) => i.path).join(", ")}` : code,
    );
    this.name = "ReviewError";
  }
}
