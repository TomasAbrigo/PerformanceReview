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
      withAdvisoryLock("ingest:test-entity", async () => {
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
      withAdvisoryLock(key, async () => {
        events.push(`${key} start`);
        await sleep(150);
        events.push(`${key} end`);
      });

    await Promise.all([job("ingest:one"), job("ingest:two")]);

    expect(events.slice(0, 2).every((e) => e.endsWith("start"))).toBe(true);
  });

  it("returns the result, and releases the lock when the function throws", async () => {
    await expect(
      withAdvisoryLock("ingest:throws", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await withAdvisoryLock("ingest:throws", async () => 42)).toBe(42);
    // No session is left holding it.
    const held = await db.execute(
      sql`select count(*)::int as n from pg_locks
        where locktype = 'advisory'
          and database = (select oid from pg_database where datname = current_database())`,
    );
    expect(held[0].n).toBe(0);
  });
});
