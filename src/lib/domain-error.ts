import type { ZodError, ZodType } from "zod";

export type FieldIssue = { path: string; message: string };

/** Base for module errors: a stable `code` the UI translates, plus field issues. */
export class DomainError<Code extends string = string> extends Error {
  constructor(
    readonly code: Code,
    readonly issues: FieldIssue[] = [],
  ) {
    super(
      issues.length
        ? `${code}: ${issues.map((i) => `${i.path} ${i.message}`).join(", ")}`
        : code,
    );
    this.name = new.target.name;
  }

  /** A "validation" error of the calling subclass from a zod error. */
  static fromZod<T extends DomainError>(
    this: new (code: "validation", issues: FieldIssue[]) => T,
    error: ZodError,
  ): T {
    return new this(
      "validation",
      error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
}

/** Parses `input` or throws `ErrorClass.fromZod` (code "validation"). */
export function parse<T>(
  schema: ZodType<T>,
  input: unknown,
  ErrorClass: new (code: "validation", issues: FieldIssue[]) => DomainError,
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ErrorClass(
    "validation",
    result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  );
}
