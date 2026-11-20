import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { ingestRun, reviewCycle } from "@/db/schema";
import type { HandlerContext } from "@/modules/ingest/handlers";
import { cycleForPeriod } from "./cycle-target";
import { resetDb } from "./test-support";

/** A fresh run's context (each run has its own cache, as in an import). */
async function run(): Promise<HandlerContext> {
  const [r] = await db
    .insert(ingestRun)
    .values({ entity: "assessment" })
    .returning({ id: ingestRun.id });
  return { runId: r.id, cache: new Map() } as unknown as HandlerContext;
}

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("cycleForPeriod (#132)", () => {
  it("puts starts a few days apart in one semester's cycle, whatever the file", async () => {
    const a = await cycleForPeriod(db, await run(), "2024-03-29");
    const b = await cycleForPeriod(db, await run(), "2024-03-25");
    const c = await cycleForPeriod(db, await run(), "2024-04-02");
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(await db.select().from(reviewCycle)).toHaveLength(1);
  });

  it("keeps semesters apart", async () => {
    const a = await cycleForPeriod(db, await run(), "2024-03-29");
    const b = await cycleForPeriod(db, await run(), "2024-09-29");
    expect(b.id).not.toBe(a.id);
  });

  it("takes the real end of the status file when the cycle already exists", async () => {
    const inferred = await cycleForPeriod(db, await run(), "2024-03-29");
    expect(inferred.periodEnd).toBe("2024-09-28");
    const real = await cycleForPeriod(
      db,
      await run(),
      "2024-03-29",
      "2024-09-30",
    );
    expect(real.id).toBe(inferred.id);
    expect(real.periodEnd).toBe("2024-09-30");
    const [stored] = await db.select().from(reviewCycle);
    expect(stored.periodEnd).toBe("2024-09-30");
    expect(stored.name).toBe("Evaluación semestral 2024-03-29 – 2024-09-30");
  });
});
