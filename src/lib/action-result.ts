import { refresh } from "next/cache";

type IssuesOf<E> = E extends { issues: infer I } ? I : never[];

/** What a server action hands back to the client instead of throwing. */
export type ActionOutcome<T extends object, E extends { code: string }> =
  ({ ok: true } & T) | { ok: false; code: string; issues: IssuesOf<E> };

/**
 * Runs a server action body: on success refreshes the page and returns
 * `{ ok: true, ...whatItReturned }`; a domain error (recognised by
 * `isDomainError`) becomes `{ ok: false, code, issues }`; anything else is
 * logged and reported as code `unknown`, never leaked to the client.
 */
export async function actionResult<
  T extends object = object,
  E extends { code: string } = never,
>(
  fn: () => Promise<T | void>,
  isDomainError: (error: unknown) => error is E,
): Promise<ActionOutcome<T, E>> {
  try {
    const value = (await fn()) ?? ({} as T);
    refresh();
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
