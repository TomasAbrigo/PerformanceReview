import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { notification } from "@/db/schema";
import {
  createNotification,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from ".";
import { as, hr, resetAll, seedPeople, type Seed } from "./test-support";

let seed: Seed;

beforeAll(async () => {
  await resetAll();
  seed = await seedPeople();
});

beforeEach(async () => {
  await db.delete(notification);
});

afterAll(async () => {
  await resetAll();
  await closeDb();
});

const base = (key: string, recipient = seed.bruno) => ({
  recipientPersonId: recipient,
  kind: "reminder_due" as const,
  payload: { cycleName: "H1 2022", dueDate: "2022-07-15", daysLeft: 7 },
  dedupeKey: key,
});

/** Inserts with an explicit created_at (minutes after a fixed instant). */
async function insertAt(
  key: string,
  minute: number,
  { recipient = seed.bruno, read = false } = {},
) {
  const createdAt = new Date(Date.UTC(2026, 6, 1, 12, minute));
  const [row] = await db
    .insert(notification)
    .values({
      ...base(key, recipient),
      createdAt,
      readAt: read ? new Date(Date.UTC(2026, 6, 2)) : null,
    })
    .returning();
  return row;
}

describe("createNotification", () => {
  it("creates once per dedupe key and reports whether it created", async () => {
    expect(await createNotification(db, base("k1"))).toBe(true);
    expect(await createNotification(db, base("k1"))).toBe(false);
    expect(await db.select().from(notification)).toHaveLength(1);
  });

  it("stores the kind, the template variables and no read mark", async () => {
    await createNotification(db, base("k1"));
    const [row] = await db.select().from(notification);
    expect(row).toMatchObject({
      recipientPersonId: seed.bruno,
      kind: "reminder_due",
      cycleId: null,
      requestId: null,
      readAt: null,
      payload: { cycleName: "H1 2022", dueDate: "2022-07-15", daysLeft: 7 },
    });
  });

  it("different keys for the same person and kind are different notifications", async () => {
    await createNotification(db, base("k1"));
    await createNotification(db, base("k2"));
    expect(await db.select().from(notification)).toHaveLength(2);
  });
});

describe("unreadCount", () => {
  it("counts only the actor's unread notifications", async () => {
    await insertAt("a", 1);
    await insertAt("b", 2);
    await insertAt("c", 3, { read: true });
    await insertAt("d", 4, { recipient: seed.ana });
    expect(await unreadCount(db, as(seed.bruno))).toBe(2);
    expect(await unreadCount(db, as(seed.ana))).toBe(1);
    expect(await unreadCount(db, as(seed.carla))).toBe(0);
  });

  it("only needs to know who", async () => {
    await insertAt("a", 1);
    expect(await unreadCount(db, { personId: seed.bruno })).toBe(1);
  });

  it("is 0 for the People team acting without a person", async () => {
    await insertAt("a", 1);
    expect(await unreadCount(db, hr)).toBe(0);
  });

  it("counts for a person acting as HR", async () => {
    await insertAt("a", 1);
    expect(await unreadCount(db, as(seed.bruno, "hr"))).toBe(1);
  });
});

describe("listNotifications", () => {
  it("lists unread first, then read, newest first within each", async () => {
    await insertAt("read-new", 5, { read: true });
    await insertAt("unread-old", 1);
    await insertAt("read-old", 2, { read: true });
    await insertAt("unread-new", 4);
    const { items } = await listNotifications(db, as(seed.bruno));
    expect(items.map((i) => i.readAt !== null)).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(items.map((i) => i.createdAt.getUTCMinutes())).toEqual([4, 1, 5, 2]);
  });

  it("only lists the actor's own notifications", async () => {
    await insertAt("mine", 1);
    await insertAt("theirs", 2, { recipient: seed.ana });
    const { items } = await listNotifications(db, as(seed.bruno));
    expect(items).toHaveLength(1);
    expect((await listNotifications(db, hr)).items).toEqual([]);
  });

  it("filters unread only", async () => {
    await insertAt("a", 1);
    await insertAt("b", 2, { read: true });
    const { items } = await listNotifications(db, as(seed.bruno), {
      unreadOnly: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0].readAt).toBeNull();
  });

  it("returns the kind, payload and links of each item", async () => {
    await db.insert(notification).values({
      ...base("with-links"),
      kind: "manual_reminder",
      payload: { cycleName: "H1", senderName: "Carla Romero" },
    });
    const [item] = (await listNotifications(db, as(seed.bruno))).items;
    expect(item).toMatchObject({
      kind: "manual_reminder",
      payload: { cycleName: "H1", senderName: "Carla Romero" },
      cycleId: null,
      requestId: null,
    });
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("pages with a cursor without gaps or repeats, even with equal timestamps", async () => {
    // Two rows share a timestamp; one read row sits at the end of the order.
    await insertAt("a", 5);
    await insertAt("b", 4);
    await insertAt("c", 4);
    await insertAt("d", 3);
    await insertAt("e", 9, { read: true });
    await insertAt("f", 1, { read: true });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listNotifications(db, as(seed.bruno), {
        limit: 2,
        cursor,
      });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    const all = await listNotifications(db, as(seed.bruno), { limit: 50 });
    expect(all.nextCursor).toBeNull();
    expect(seen).toEqual(all.items.map((i) => i.id));
    expect(new Set(seen).size).toBe(6);
  });

  it("keeps paging through the unread rows when the row the cursor points at is marked read in between", async () => {
    const a = await insertAt("a", 5);
    const b = await insertAt("b", 4);
    const c = await insertAt("c", 3);
    const d = await insertAt("d", 2);
    const e = await insertAt("e", 9, { read: true });
    const first = await listNotifications(db, as(seed.bruno), { limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual([a.id, b.id]);
    // The reader marks the last row of the page read before asking for more.
    await markRead(db, as(seed.bruno), [b.id]);
    const second = await listNotifications(db, as(seed.bruno), {
      limit: 3,
      cursor: first.nextCursor!,
    });
    // c and d are still unread and still come next; no unread row is skipped.
    expect(second.items.map((i) => i.id)).toEqual([c.id, d.id, e.id]);
  });

  it("pages by the exact timestamp, not by milliseconds", async () => {
    // Three rows less than a millisecond apart (JS dates would truncate them).
    const ids: string[] = [];
    for (const [key, micros] of [
      ["x", "123900"],
      ["y", "123500"],
      ["z", "123100"],
    ]) {
      const [row] = await db
        .insert(notification)
        .values({
          ...base(key),
          createdAt: sql`('2026-07-01 12:00:00.' || ${micros})::timestamptz`,
        })
        .returning({ id: notification.id });
      ids.push(row.id);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listNotifications(db, as(seed.bruno), {
        limit: 1,
        cursor,
      });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && seen.length < 10);
    expect(seen).toEqual(ids);
  });

  it("clamps the limit and ignores a malformed or forged cursor", async () => {
    await insertAt("a", 1);
    for (const cursor of [
      "not-a-cursor",
      "00000000-0000-4000-8000-000000000000",
      Buffer.from(
        JSON.stringify({ r: 0, t: "x'; drop table", i: "y" }),
      ).toString("base64url"),
    ]) {
      const page = await listNotifications(db, as(seed.bruno), {
        limit: 0,
        cursor,
      });
      expect(page.items).toHaveLength(1);
    }
  });
});

describe("markRead / markAllRead", () => {
  it("marks the actor's notifications read and counts what changed", async () => {
    const a = await insertAt("a", 1);
    const b = await insertAt("b", 2);
    expect(await markRead(db, as(seed.bruno), [a.id])).toBe(1);
    expect(await unreadCount(db, as(seed.bruno))).toBe(1);
    const [row] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, a.id));
    expect(row.readAt).toBeInstanceOf(Date);
    // Marking again changes nothing (and keeps the first read time).
    expect(await markRead(db, as(seed.bruno), [a.id, b.id])).toBe(1);
    const [again] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, a.id));
    expect(again.readAt).toEqual(row.readAt);
  });

  it("never marks somebody else's notification", async () => {
    const theirs = await insertAt("theirs", 1, { recipient: seed.ana });
    expect(await markRead(db, as(seed.bruno), [theirs.id])).toBe(0);
    expect(await markRead(db, hr, [theirs.id])).toBe(0);
    expect(await unreadCount(db, as(seed.ana))).toBe(1);
  });

  it("ignores ids that are not uuids", async () => {
    const a = await insertAt("a", 1);
    expect(await markRead(db, as(seed.bruno), ["nope", a.id])).toBe(1);
    expect(await markRead(db, as(seed.bruno), [])).toBe(0);
  });

  it("markAllRead clears only the actor's unread notifications", async () => {
    await insertAt("a", 1);
    await insertAt("b", 2);
    await insertAt("c", 3, { recipient: seed.ana });
    expect(await markAllRead(db, as(seed.bruno))).toBe(2);
    expect(await unreadCount(db, as(seed.bruno))).toBe(0);
    expect(await unreadCount(db, as(seed.ana))).toBe(1);
    expect(await markAllRead(db, hr)).toBe(0);
  });
});
