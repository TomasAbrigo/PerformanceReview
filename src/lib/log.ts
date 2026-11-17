import { redactEmails } from "./sensitive-data";

/**
 * Error text that is safe to log, print or store. A driver error can carry
 * the row it choked on ("Key (work_email)=(...) already exists", the params
 * of a failed query), so nothing prints an error object raw: it goes through
 * here, which replaces every email address with `[email]`.
 */

/** The message of an error (or the text of any thrown value), redacted. */
export function errorMessage(error: unknown): string {
  return redactEmails(error instanceof Error ? error.message : String(error));
}

/** What a PostgreSQL error says about where it happened (no row values: `detail` is separate). */
const PG_FIELDS = [
  "code",
  "severity",
  "constraint_name",
  "schema_name",
  "table_name",
  "column_name",
  "hint",
  "where",
] as const;

/** An error with its stack, causes and the PostgreSQL fields, redacted. */
export function describeError(error: unknown): string {
  // One block per error of the cause chain.
  const blocks: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 8; depth++) {
    if (!(current instanceof Error)) {
      blocks.push(String(current));
      break;
    }
    const lines = [current.stack ?? `${current.name}: ${current.message}`];
    const pg = current as unknown as Record<string, unknown>;
    const fields = PG_FIELDS.filter((key) => typeof pg[key] === "string").map(
      (key) => `${key}=${pg[key]}`,
    );
    if (fields.length > 0) lines.push(`fields: ${fields.join(" ")}`);
    if (typeof pg.detail === "string") lines.push(`detail: ${pg.detail}`);
    blocks.push(lines.join("\n"));
    current = current.cause;
  }
  return redactEmails(blocks.join("\nCaused by: "));
}

/** `console.error` for unexpected errors, with no email in it. */
export function logError(error: unknown, context?: string): void {
  const text = describeError(error);
  console.error(context ? `${context}: ${text}` : text);
}
