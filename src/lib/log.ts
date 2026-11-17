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

/** An error with its stack, causes and a driver's `detail`, redacted. */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 8; depth++) {
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    parts.push(current.stack ?? `${current.name}: ${current.message}`);
    const { detail } = current as { detail?: unknown };
    if (typeof detail === "string") parts.push(`detail: ${detail}`);
    current = current.cause;
  }
  return redactEmails(parts.join("\nCaused by: "));
}

/** `console.error` for unexpected errors, with no email in it. */
export function logError(error: unknown, context?: string): void {
  const text = describeError(error);
  console.error(context ? `${context}: ${text}` : text);
}
