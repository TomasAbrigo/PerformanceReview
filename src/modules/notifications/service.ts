import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { notification, type NewNotification } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import type { ActorContext } from "@/modules/actor/types";
import type { NotificationKind, NotificationPayload } from "./kinds";

/** What the creators build: one event for one recipient. */
export type NotificationInput = {
  recipientPersonId: string;
  kind: NotificationKind;
  cycleId?: string | null;
  requestId?: string | null;
  payload?: NotificationPayload;
  /** Identifies the event: the same key is created at most once. */
  dedupeKey: string;
};

const toRow = (input: NotificationInput): NewNotification => ({
  recipientPersonId: input.recipientPersonId,
  kind: input.kind,
  cycleId: input.cycleId ?? null,
  requestId: input.requestId ?? null,
  payload: input.payload ?? {},
  dedupeKey: input.dedupeKey,
});

// Postgres takes 65535 bind parameters per statement; a row binds 6.
const INSERT_CHUNK = 1000;

/**
 * Creates `inputs`, skipping those whose dedupe key already exists (so it is
 * safe to run twice, or concurrently). Returns how many were created.
 */
export async function createNotifications(
  db: DbOrTx,
  inputs: NotificationInput[],
): Promise<number> {
  let created = 0;
  for (let i = 0; i < inputs.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(notification)
      .values(inputs.slice(i, i + INSERT_CHUNK).map(toRow))
      .onConflictDoNothing({ target: notification.dedupeKey })
      .returning({ id: notification.id });
    created += rows.length;
  }
  return created;
}

/**
 * Creates one notification unless its dedupe key already exists. Returns
 * whether it was created. The stable entry point for the modules that raise
 * events (reminders, sharing, feedback, calibration, phase changes).
 */
export async function createNotification(
  db: DbOrTx,
  input: NotificationInput,
): Promise<boolean> {
  return (await createNotifications(db, [input])) === 1;
}

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  cycleId: string | null;
  requestId: string | null;
  payload: NotificationPayload;
  createdAt: Date;
  readAt: Date | null;
};

export type NotificationPage = {
  items: NotificationItem[];
  /** Pass it as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * The actor's notifications: unread first, then read, newest first within
 * each. `cursor` is the `nextCursor` of the previous page. Without a person
 * (People acting as the team) there is no inbox.
 */
export async function listNotifications(
  db: DbOrTx,
  actor: ActorContext,
  {
    unreadOnly = false,
    limit = DEFAULT_LIMIT,
    cursor,
  }: { unreadOnly?: boolean; limit?: number; cursor?: string } = {},
): Promise<NotificationPage> {
  const personId = actor.personId;
  if (!personId) return { items: [], nextCursor: null };
  const size = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_LIMIT);

  // The cursor row's own values are read by SQL (not round-tripped through JS
  // dates, which would truncate microseconds and skip or repeat rows).
  let after;
  if (cursor && isUuid(cursor)) {
    const [row] = await db
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.id, cursor),
          eq(notification.recipientPersonId, personId),
        ),
      );
    if (row) {
      const cur = (expr: string) =>
        sql`(select ${sql.raw(expr)} from notification c where c.id = ${cursor})`;
      const isRead = sql`(${notification.readAt} is not null)`;
      after = or(
        sql`${isRead} > ${cur("c.read_at is not null")}`,
        and(
          sql`${isRead} = ${cur("c.read_at is not null")}`,
          or(
            lt(notification.createdAt, cur("c.created_at")),
            and(
              eq(notification.createdAt, cur("c.created_at")),
              lt(notification.id, cur("c.id")),
            ),
          ),
        ),
      );
    }
  }

  const rows = await db
    .select({
      id: notification.id,
      kind: notification.kind,
      cycleId: notification.cycleId,
      requestId: notification.requestId,
      payload: notification.payload,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
    })
    .from(notification)
    .where(
      and(
        eq(notification.recipientPersonId, personId),
        unreadOnly ? isNull(notification.readAt) : undefined,
        after,
      ),
    )
    .orderBy(
      asc(sql`(${notification.readAt} is not null)`),
      desc(notification.createdAt),
      desc(notification.id),
    )
    .limit(size + 1);

  const items = rows.slice(0, size);
  return {
    items,
    nextCursor: rows.length > size ? items[items.length - 1].id : null,
  };
}

/** Number of unread notifications of the actor (the header badge). */
export async function unreadCount(
  db: DbOrTx,
  actor: ActorContext,
): Promise<number> {
  if (!actor.personId) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(notification)
    .where(
      and(
        eq(notification.recipientPersonId, actor.personId),
        isNull(notification.readAt),
      ),
    );
  return row.n;
}

/**
 * Marks the actor's own notifications read. Ids that are not theirs (or not
 * ids) are ignored, so nothing is learned about other people's inboxes.
 * Returns how many changed.
 */
export async function markRead(
  db: DbOrTx,
  actor: ActorContext,
  ids: string[],
): Promise<number> {
  const valid = ids.filter(isUuid);
  if (!actor.personId || valid.length === 0) return 0;
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        inArray(notification.id, valid),
        eq(notification.recipientPersonId, actor.personId),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}

/** Marks every unread notification of the actor read. Returns how many. */
export async function markAllRead(
  db: DbOrTx,
  actor: ActorContext,
): Promise<number> {
  if (!actor.personId) return 0;
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.recipientPersonId, actor.personId),
        isNull(notification.readAt),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}
