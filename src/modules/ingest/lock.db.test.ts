import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { sql } from "drizzle-orm";
import { withAdvisoryLock } from "./lock";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withAdvisoryLock", () => {
  afterAll(closeDb);

  it("makes overlapping callers with the same key take turns", async () => {
    const events: string[] = [];
    const job = (name: string) =>
      withAdvisoryLock(db, "ingest:test-entity", async () => {
        events.push(`${name} start`);
        await sleep(150);
        events.push(`${name} end`);
      });

    await Promise.all([job("a"), job("b")]);

    expect(events).toHaveLength(4);
    // Never interleaved: each start is followed by its own end.
    expect(events[0].split(" ")[0]).toBe(events[1].split(" ")[0]);
    expect(events[2].split(" ")[0]).toBe(events[3].split(" ")[0]);
  });

  it("lets different keys run at the same time", async () => {
    const events: string[] = [];
    const job = (key: string) =>
      withAdvisoryLock(db, key, async () => {
        events.push(`${key} start`);
        await sleep(150);
        events.push(`${key} end`);
      });

    await Promise.all([job("ingest:one"), job("ingest:two")]);

    expect(events.slice(0, 2).every((e) => e.endsWith("start"))).toBe(true);
  });

  it("returns the result, and releases the lock when the function throws", async () => {
    await expect(
      withAdvisoryLock(db, "ingest:throws", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await withAdvisoryLock(db, "ingest:throws", async () => 42)).toBe(
      42,
    );
    // No session is left holding it.
    const held = await db.execute(
      sql`select count(*)::int as n from pg_locks
        where locktype = 'advisory'
          and database = (select oid from pg_database where datname = current_database())`,
    );
    expect(held[0].n).toBe(0);
  });

  it("is held by one transaction, so it works behind a transaction pooler", async () => {
    // A transaction-level lock shows up in pg_locks while the function runs and
    // is gone right after (no session keeps it).
    const during = await withAdvisoryLock(db, "ingest:pooler", async () => {
      const rows = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_locks
          where locktype = 'advisory' and granted
            and database = (select oid from pg_database where datname = current_database())`,
      );
      return rows[0].n;
    });
    expect(during).toBe(1);

    // The same lock key taken from another connection waits for it.
    const order: string[] = [];
    await Promise.all([
      withAdvisoryLock(db, "ingest:pooler", async () => {
        order.push("first in");
        await sleep(150);
        order.push("first out");
      }),
      sleep(30).then(() =>
        withAdvisoryLock(db, "ingest:pooler", async () => {
          order.push("second in");
        }),
      ),
    ]);
    expect(order).toEqual(["first in", "first out", "second in"]);
  });
});
