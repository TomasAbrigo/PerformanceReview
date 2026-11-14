import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  cycleParticipant,
  person,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import { addDays, daysBetween, todayLocal } from "@/modules/org-history/dates";
import type { DueDatePhase } from "@/modules/review-core/status";
import { writablePhases } from "@/modules/review-core/visibility";
import {
  relationships,
  type Relationship,
} from "@/modules/templates/constants";
import { NotificationError } from "./errors";
import type { NotificationPayload } from "./kinds";
import { createNotification, createNotifications } from "./service";
import type { NotificationInput } from "./service";

/** Days before the due date a reminder goes out: 7, 1 and the day itself. */
export const DEFAULT_REMINDER_OFFSETS: readonly number[] = [7, 1, 0];

/**
 * The cycle due date each kind of review answers to (cycle.due_dates).
 * Upward feedback has no window of its own: it is collected with peers.
 */
const dueDatePhase: Record<Relationship, DueDatePhase> = {
  self: "self",
  manager: "manager",
  peer: "peer",
  upward: "peer",
};

/**
 * A request is outstanding (a task of its reviewer) when it is a draft, its
 * reviewee is still in the cycle and the cycle is alive, started and not
 * closed.
 */
const outstandingRequest = and(
  eq(reviewRequest.status, "draft"),
  isNull(reviewRequest.deletedAt),
  isNull(cycleParticipant.removedAt),
  isNull(reviewCycle.deletedAt),
  notInArray(reviewCycle.status, ["draft", "closed"]),
);

/** The review can be written now: its cycle is in a phase that allows it (`writablePhases`). */
const writableNow = or(
  ...relationships.map((r) =>
    and(
      eq(reviewRequest.relationship, r),
      inArray(reviewCycle.status, [...writablePhases[r]]),
    ),
  ),
);

// Built from the constants above, never from input.
const dueDateOfRequest = sql<
  string | null
>`${reviewCycle.dueDates} ->> (case ${reviewRequest.relationship}::text ${sql.raw(
  relationships.map((r) => `when '${r}' then '${dueDatePhase[r]}'`).join(" "),
)} end)`;

export type DueRemindersResult = {
  asOf: string;
  offsets: number[];
  /** Reminders due on `asOf` (new or already created by an earlier run). */
  candidates: number;
  /** The ones this run created. */
  created: number;
};

/**
 * Creates a `reminder_due` notification for every outstanding request (draft,
 * reviewee still in a live, started, not closed cycle) whose due date is
 * exactly `asOf` + one of the `offsets` days. Reminders ahead of the deadline
 * (offset > 0) need nothing else; the one for the day itself (offset 0) also
 * needs the review to be writable in its cycle's current phase
 * (`writablePhases`), so nobody is told "due today" about something they can
 * no longer write. Idempotent: the dedupe key
 * (`reminder_due:<requestId>:<daysLeft>:<dueDate>`) makes a second run on the
 * same day, or two concurrent ones, create nothing. Meant to run once a day
 * (`pnpm notifications:run`); a day it does not run is a day of reminders
 * lost, by design (no catch-up spam).
 */
export async function generateDueReminders(
  db: DbOrTx,
  {
    asOf = todayLocal(),
    offsets = DEFAULT_REMINDER_OFFSETS,
  }: { asOf?: string; offsets?: readonly number[] } = {},
): Promise<DueRemindersResult> {
  // Reminders ahead of the deadline (offset > 0) go to anyone with an
  // outstanding request: the phase it is written in may not have started yet
  // (a manager review is due in a later phase than the one it opens in), and
  // a lead reminder is a heads-up. "Due today" (offset <= 0) only goes to
  // those who can still write it.
  const days = [...new Set(offsets)];
  const lead = days.filter((n) => n > 0).map((n) => addDays(asOf, n));
  const due = days.filter((n) => n <= 0).map((n) => addDays(asOf, n));
  const result = { asOf, offsets: [...offsets], candidates: 0, created: 0 };
  if (lead.length + due.length === 0) return result;

  const rows = await db
    .select({
      requestId: reviewRequest.id,
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      reviewerPersonId: reviewRequest.reviewerPersonId,
      relationship: reviewRequest.relationship,
      dueDate: dueDateOfRequest,
      participantName: person.displayName,
    })
    .from(reviewRequest)
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .where(
      and(
        outstandingRequest,
        isNotNull(reviewRequest.reviewerPersonId),
        or(
          lead.length ? inArray(dueDateOfRequest, lead) : undefined,
          due.length
            ? and(inArray(dueDateOfRequest, due), writableNow)
            : undefined,
        ),
      ),
    );

  const inputs: NotificationInput[] = [];
  for (const row of rows) {
    // A manager request may have no reviewer (no manager at the snapshot).
    if (!row.reviewerPersonId || !row.dueDate) continue;
    const daysLeft = daysBetween(asOf, row.dueDate);
    inputs.push({
      recipientPersonId: row.reviewerPersonId,
      kind: "reminder_due",
      cycleId: row.cycleId,
      requestId: row.requestId,
      payload: {
        cycleName: row.cycleName,
        dueDate: row.dueDate,
        daysLeft,
        relationship: row.relationship,
        ...(row.relationship === "self"
          ? {}
          : { participantName: row.participantName }),
      },
      dedupeKey: `reminder_due:${row.requestId}:${daysLeft}:${row.dueDate}`,
    });
  }
  result.candidates = inputs.length;
  result.created = await createNotifications(db, inputs);
  return result;
}

/**
 * Manual reminder ("Recordar"): the snapshot manager of the request's
 * reviewee, or HR, nudges the reviewer of an outstanding request (draft,
 * active reviewee, live started cycle in any phase). At most one per sender
 * and request per day (`created: false` on the repeat), so a double click or
 * a nervous manager does not flood the inbox.
 *
 * Throws NotificationError: not_found, forbidden, not_pending.
 */
export async function remind(
  db: DbOrTx,
  actor: ActorContext,
  requestId: string,
  { asOf = todayLocal() }: { asOf?: string } = {},
): Promise<{ created: boolean }> {
  if (!isUuid(requestId)) throw new NotificationError("not_found");
  const [row] = await db
    .select({
      cycleId: reviewCycle.id,
      cycleName: reviewCycle.name,
      dueDate: dueDateOfRequest,
      relationship: reviewRequest.relationship,
      reviewerPersonId: reviewRequest.reviewerPersonId,
      snapManagerPersonId: cycleParticipant.snapManagerPersonId,
      participantName: person.displayName,
      outstanding: sql<boolean>`coalesce(${outstandingRequest}, false)`,
    })
    .from(reviewRequest)
    .innerJoin(reviewCycle, eq(reviewCycle.id, reviewRequest.cycleId))
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, reviewRequest.participantId),
    )
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .where(
      and(
        eq(reviewRequest.id, requestId),
        isNull(reviewRequest.deletedAt),
        isNull(reviewCycle.deletedAt),
      ),
    );
  if (!row) throw new NotificationError("not_found");

  const isManager =
    actor.personId !== null && actor.personId === row.snapManagerPersonId;
  if (actor.role !== "hr" && !isManager) {
    throw new NotificationError("forbidden");
  }
  // A manager request without reviewer has nobody to remind.
  if (!row.outstanding || !row.reviewerPersonId) {
    throw new NotificationError("not_pending");
  }

  let senderName: string | null = null;
  if (actor.personId) {
    const [sender] = await db
      .select({ name: person.displayName })
      .from(person)
      .where(eq(person.id, actor.personId));
    senderName = sender?.name ?? null;
  }
  const payload: NotificationPayload = {
    cycleName: row.cycleName,
    relationship: row.relationship,
    senderName,
    ...(row.dueDate ? { dueDate: row.dueDate } : {}),
    ...(row.relationship === "self"
      ? {}
      : { participantName: row.participantName }),
  };
  const created = await createNotification(db, {
    recipientPersonId: row.reviewerPersonId,
    kind: "manual_reminder",
    cycleId: row.cycleId,
    requestId,
    payload,
    dedupeKey: `manual_reminder:${requestId}:${actor.personId ?? "hr"}:${asOf}`,
  });
  return { created };
}
