import { desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { followUpNote, person } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  isManagerSideOf,
  isRevieweeOf,
  isShared,
  loadParticipantScope,
} from "./participant-scope";
import { ReviewError } from "./review-errors";

export const FOLLOW_UP_MAX_LENGTH = 4000;

export type FollowUpNote = {
  id: string;
  participantId: string;
  /** Null when People wrote it without acting as a person. */
  authorPersonId: string | null;
  authorName: string | null;
  body: string;
  createdAt: Date;
};

/**
 * Adds a follow-up note about a participant (agreements after the review
 * conversation). Append-only: notes are never edited or deleted. Written by
 * the participant's snapshot manager (or the manager review's reviewer) or
 * HR, once the manager review is submitted.
 */
export async function addFollowUpNote(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
  body: string,
): Promise<FollowUpNote> {
  const scope = await loadParticipantScope(db, participantId);
  if (actor.role !== "hr" && !isManagerSideOf(actor, scope)) {
    throw new ReviewError("forbidden");
  }
  if (scope.managerRequest?.status !== "submitted") {
    throw new ReviewError("not_submitted");
  }
  const text = body.trim();
  if (text === "") {
    throw new ReviewError("validation", [
      { path: "body", message: "required" },
    ]);
  }
  if (text.length > FOLLOW_UP_MAX_LENGTH) {
    throw new ReviewError("validation", [
      { path: "body", message: "too_long" },
    ]);
  }
  const [row] = await db
    .insert(followUpNote)
    .values({ participantId, authorPersonId: actor.personId, body: text })
    .returning();
  return { ...row, authorName: await authorName(db, row.authorPersonId) };
}

async function authorName(db: DbOrTx, personId: string | null) {
  if (!personId) return null;
  const [row] = await db
    .select({ name: person.displayName })
    .from(person)
    .where(eq(person.id, personId));
  return row?.name ?? null;
}

/**
 * The participant's follow-up notes, newest first. Visible to HR, the
 * snapshot manager (or reviewer) and, like Bamboo, to the employee, but only
 * while their manager review is shared with them.
 */
export async function listFollowUpNotes(
  db: DbOrTx,
  actor: ActorContext,
  participantId: string,
): Promise<FollowUpNote[]> {
  const scope = await loadParticipantScope(db, participantId);
  const allowed =
    actor.role === "hr" ||
    isManagerSideOf(actor, scope) ||
    (isRevieweeOf(actor, scope) && isShared(scope));
  if (!allowed) throw new ReviewError("forbidden");
  return db
    .select({
      id: followUpNote.id,
      participantId: followUpNote.participantId,
      authorPersonId: followUpNote.authorPersonId,
      authorName: person.displayName,
      body: followUpNote.body,
      createdAt: followUpNote.createdAt,
    })
    .from(followUpNote)
    .leftJoin(person, eq(person.id, followUpNote.authorPersonId))
    .where(eq(followUpNote.participantId, participantId))
    .orderBy(desc(followUpNote.createdAt));
}
