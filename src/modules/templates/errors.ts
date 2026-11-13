import type { ZodError } from "zod";

export type TemplatesErrorCode =
  "validation" | "not_found" | "system_readonly" | "in_use";

export type FieldIssue = { path: string; message: string };

export class TemplatesError extends Error {
  constructor(
    readonly code: TemplatesErrorCode,
    readonly issues: FieldIssue[] = [],
  ) {
    super(
      issues.length
        ? `${code}: ${issues.map((i) => `${i.path} ${i.message}`).join(", ")}`
        : code,
    );
    this.name = "TemplatesError";
  }

  static fromZod(error: ZodError): TemplatesError {
    return new TemplatesError(
      "validation",
      error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
}
