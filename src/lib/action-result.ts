import { refresh } from "next/cache";
import { DomainError, type FieldIssue } from "./domain-error";

type IssuesOf<E> = E extends { issues: infer I } ? I : never[];

/** What a server action hands back to the client instead of throwing. */
export type ActionOutcome<T extends object, E extends { code: string }> =
  ({ ok: true } & T) | { ok: false; code: string; issues: IssuesOf<E> };

/** Outcome of an action whose domain errors carry field issues. */
export type ActionResult<T = unknown> =
  ({ ok: true } & T) | { ok: false; code: string; issues: FieldIssue[] };

const isAnyDomainError = (error: unknown): error is DomainError =>
  error instanceof DomainError;

/**
 * Runs a server action body: on success refreshes the page (unless
 * `refreshPage: false`, e.g. read-only previews) and returns
 * `{ ok: true, ...whatItReturned }`; a domain error (recognised by
 * `isDomainError`, by default any `DomainError`) becomes
 * `{ ok: false, code, issues }`; anything else is logged and reported as code
 * `unknown`, never leaked to the client.
 */
export async function actionResult<
  T extends object = object,
  E extends { code: string } = DomainError,
>(
  fn: () => Promise<T | void>,
  isDomainError: (
    error: unknown,
  ) => error is E = isAnyDomainError as unknown as (
    error: unknown,
  ) => error is E,
  { refreshPage = true }: { refreshPage?: boolean } = {},
): Promise<ActionOutcome<T, E>> {
  try {
    const value = (await fn()) ?? ({} as T);
    if (refreshPage) refresh();
    return { ok: true, ...value };
  } catch (error) {
    if (isDomainError(error)) {
      const issues = "issues" in error ? error.issues : [];
      return { ok: false, code: error.code, issues: issues as IssuesOf<E> };
    }
    console.error(error);
    return { ok: false, code: "unknown", issues: [] as IssuesOf<E> };
  }
}
