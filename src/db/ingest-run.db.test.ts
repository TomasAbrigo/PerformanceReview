import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./client";
import { ingestRun } from "./schema";

describe("ingest_run", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("inserts and reads back a row with defaults applied", async () => {
    const [inserted] = await db
      .insert(ingestRun)
      .values({
        sourceSystem: "bamboohr",
        adapter: "employees",
        entity: "employee",
        counts: { read: 0 },
      })
      .returning();

    try {
      expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(inserted.startedAt).toBeInstanceOf(Date);
      expect(inserted.status).toBe("running");

      const [found] = await db
        .select()
        .from(ingestRun)
        .where(eq(ingestRun.id, inserted.id));

      expect(found).toMatchObject({
        sourceSystem: "bamboohr",
        adapter: "employees",
        status: "running",
        counts: { read: 0 },
        finishedAt: null,
        error: null,
      });
    } finally {
      await db.delete(ingestRun).where(eq(ingestRun.id, inserted.id));
    }
  });

  it("only knows the running, succeeded and error statuses", async () => {
    // Raw SQL: the typed insert would not even compile with another status.
    await expect(
      pgError(
        db.execute(
          sql`insert into ingest_run (entity, status) values ('employee', 'failed')`,
        ),
      ),
    ).resolves.toMatch(/invalid input value for enum ingest_run_status/);
  });

  it("requires an entity and a start time", async () => {
    await expect(
      pgError(
        db.execute(sql`insert into ingest_run (status) values ('running')`),
      ),
    ).resolves.toMatch(/null value in column "entity"/);
    await expect(
      pgError(
        db.execute(
          sql`insert into ingest_run (entity, started_at) values ('employee', null)`,
        ),
      ),
    ).resolves.toMatch(/null value in column "started_at"/);
  });

  it("indexes the list order and the entity filter", async () => {
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = 'ingest_run'`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        "ingest_run_started_at_idx",
        "ingest_run_entity_started_at_idx",
      ]),
    );
  });
});

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function pgError(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: Error }).cause;
    return (cause ?? (error as Error)).message;
  }
  throw new Error("the query should have failed");
}
