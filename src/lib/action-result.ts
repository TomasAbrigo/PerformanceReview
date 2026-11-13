import { refresh } from "next/cache";
import { DomainError, type FieldIssue } from "./domain-error";

export type ActionResult<T = unknown> =
  ({ ok: true } & T) | { ok: false; code: string; issues: FieldIssue[] };

/**
 * Runs a Server Action body: on success returns `{ ok: true, ...value }` (and
 * refreshes the page unless `refreshPage` is false); domain errors become
 * `{ ok: false, code, issues }`, anything else is logged as "unknown".
 */
export async function actionResult<T extends object = object>(
  fn: () => Promise<T | void>,
  { refreshPage = false }: { refreshPage?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const value = (await fn()) ?? ({} as T);
    if (refreshPage) refresh();
    return { ok: true, ...value };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, code: error.code, issues: error.issues };
    }
    console.error(error);
    return { ok: false, code: "unknown", issues: [] };
  }
}
