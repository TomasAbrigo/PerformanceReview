import { eq } from "drizzle-orm";
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
        status: "running",
        counts: { read: 0 },
      })
      .returning();

    try {
      expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(inserted.startedAt).toBeInstanceOf(Date);

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
});
