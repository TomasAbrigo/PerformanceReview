"use server";

import { refresh } from "next/cache";
import type {
  ActionResult,
  PersonOption,
} from "@/components/identity/issue-detail";
import { db } from "@/db/client";
import { IdentityError, ignoreIssue, resolveIssue } from "@/modules/identity";
import { listPeople } from "@/modules/people/queries";

const MAX_NOTE = 500;
const SEARCH_LIMIT = 10;

async function result(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof IdentityError) return { ok: false, code: error.code };
    console.error(error);
    return { ok: false, code: "unknown" };
  }
}

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
  const people = await listPeople(db, q);
  return people
    .slice(0, SEARCH_LIMIT)
    .map(({ id, displayName, workEmail }) => ({ id, displayName, workEmail }));
}
