import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { ingestRun, rawRecord } from "@/db/schema";
import { healthCheckLanding } from "./health-check";

const clear = () => db.execute(sql`TRUNCATE raw_record, ingest_run CASCADE`);
beforeEach(clear);
afterAll(async () => {
  await clear();
  await closeDb();
});

async function land(sha256: string, rows: number, entity = "health_check") {
  const [run] = await db
    .insert(ingestRun)
    .values({
      entity,
      sourceSystem: "lake",
      adapter: "file",
      status: "succeeded",
      params: { entity, sha256 },
      finishedAt: new Date("2026-05-02T10:00:00Z"),
    })
    .returning({ id: ingestRun.id });
  for (let i = 0; i < rows; i++) {
    await db.insert(rawRecord).values({
      runId: run.id,
      sourceSystem: "lake",
      entity,
      sourceId: `row:${sha256}${i}`,
      payload: { i },
      payloadHash: `${sha256}${i}`,
      extractedAt: new Date(),
    });
  }
}

describe("healthCheckLanding", () => {
  it("nothing landed yet", async () => {
    expect(await healthCheckLanding(db)).toEqual({
      runs: 0,
      files: 0,
      rows: 0,
      lastLandedAt: null,
    });
  });

  it("counts the files, runs and rows of the health_check entity only", async () => {
    await land("a", 2);
    await land("a", 0); // the same file again: a run, no new file or rows
    await land("b", 3);
    await land("c", 4, "feedback");
    const r = await healthCheckLanding(db);
    expect(r).toMatchObject({ runs: 3, files: 2, rows: 5 });
    expect(r.lastLandedAt?.toISOString()).toBe("2026-05-02T10:00:00.000Z");
  });
});
