"use server";

import type {
  ActionResult,
  PersonOption,
} from "@/components/identity/issue-detail";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import { IdentityError, ignoreIssue, resolveIssue } from "@/modules/identity";
import { listPeople } from "@/modules/people/queries";

const MAX_NOTE = 500;
const SEARCH_LIMIT = 10;

const isIdentityError = (error: unknown): error is IdentityError =>
  error instanceof IdentityError;

/** The resolved issue stays on the server: the client only needs ok or a code. */
const result = (fn: () => Promise<unknown>): Promise<ActionResult> =>
  actionResult(async () => {
    await fn();
  }, isIdentityError);

const noteOf = (note: string) => note.trim().slice(0, MAX_NOTE) || undefined;

export async function linkIssueAction(
  issueId: string,
  personId: string,
  note: string,
) {
  return result(() =>
    resolveIssue(db, issueId, {
      action: "link",
      personId,
      actorNote: noteOf(note),
    }),
  );
}

export async function createIssueAction(issueId: string, note: string) {
  return result(() =>
    resolveIssue(db, issueId, { action: "create", actorNote: noteOf(note) }),
  );
}

export async function ignoreIssueAction(issueId: string, note: string) {
  return result(() => ignoreIssue(db, issueId, noteOf(note)));
}

/** People to link a record to, found by name or email (never the full list). */
export async function searchPeopleAction(
  query: string,
): Promise<PersonOption[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const people = await listPeople(db, q, { limit: SEARCH_LIMIT });
  return people.map(({ id, displayName, workEmail }) => ({
    id,
    displayName,
    workEmail,
  }));
}
