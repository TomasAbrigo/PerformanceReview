import type { ZodError } from "zod";
import type { FieldIssue } from "@/modules/templates/errors";

export type CyclesErrorCode =
  | "validation"
  | "not_found"
  | "not_draft"
  | "not_active"
  | "invalid_transition"
  | "no_participants"
  | "no_template"
  | "already_participant";

export class CyclesError extends Error {
  constructor(
    readonly code: CyclesErrorCode,
    readonly issues: FieldIssue[] = [],
  ) {
    super(
      issues.length
        ? `${code}: ${issues.map((i) => `${i.path} ${i.message}`).join(", ")}`
        : code,
    );
    this.name = "CyclesError";
  }

  static fromZod(error: ZodError): CyclesError {
    return new CyclesError(
      "validation",
      error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
}
