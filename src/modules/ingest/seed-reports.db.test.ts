import { count, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db, type Database } from "@/db/client";
import {
  assessmentProgress,
  cycleParticipant,
  ingestRun,
  qualitativeAnalysis,
  reviewCycle,
} from "@/db/schema";
import { withAdvisoryLock } from "./lock";
import { resetDomainTables, seedFromFixtures } from "./seed";
import { REPORT_ENTITIES, seedInsights, SEED_REPORTS } from "./seed-reports";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

async function snapshot() {
  const [cycles] = await db.select({ n: count() }).from(reviewCycle);
  const [participants] = await db.select({ n: count() }).from(cycleParticipant);
  const [progress] = await db.select({ n: count() }).from(assessmentProgress);
  const [labels] = await db.select({ n: count() }).from(qualitativeAnalysis);
  const [answers] = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from answer`,
  );
  return {
    cycles: cycles.n,
    participants: participants.n,
    progress: progress.n,
    labels: labels.n,
    answers: answers.n,
  };
}

/** What `pnpm db:seed --size small` does, on the tables only (no pre-seeded templates). */
async function seed() {
  await seedFromFixtures({ size: "small", db });
  return seedInsights({
    size: "small",
    db,
    lock: (key, fn) => withAdvisoryLock(db as Database, key, fn),
  });
}

describe("seed with reports and analysis (small)", () => {
  let first: Awaited<ReturnType<typeof snapshot>>;
  let firstRun: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    await resetDomainTables(db);
    firstRun = await seed();
    first = await snapshot();
  });
  afterAll(async () => {
    await resetDomainTables(db);
    await closeDb();
  });

  it("imports every report and labels the open texts", () => {
    expect(firstRun.ok).toBe(true);
    expect(firstRun.reports.map((r) => [r.profile, r.status])).toEqual(
      SEED_REPORTS.map((r) => [r.profile, "succeeded"]),
    );
    expect(firstRun.analysis?.analyzed).toBeGreaterThan(0);
  });

  it("creates the semi-annual cycles, participants, answers, completion rows and labels", () => {
    expect(first.cycles).toBeGreaterThan(0);
    expect(first.participants).toBeGreaterThan(0);
    expect(first.answers).toBeGreaterThan(0);
    expect(first.progress).toBeGreaterThan(0);
    expect(first.labels).toBeGreaterThan(0);
  });

  it("records the runs like an upload: profile, file and hash in params (reprocess and resume read them)", async () => {
    const runs = await db
      .select({ params: ingestRun.params })
      .from(ingestRun)
      .where(
        inArray(
          ingestRun.id,
          firstRun.reports.map((r) => r.runId!),
        ),
      );
    expect(
      runs.map((r) => (r.params as { profile?: string }).profile).sort(),
    ).toEqual(SEED_REPORTS.map((r) => r.profile).sort());
    for (const r of runs) {
      expect(r.params).toMatchObject({
        fileName: expect.stringMatching(/\.csv$/),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
    }
  });

  it("is idempotent: a second run changes nothing", async () => {
    const again = await seed();
    for (const r of again.reports) {
      expect(r.counts?.inserted).toBe(0);
      expect(r.counts?.updated).toBe(0);
    }
    expect(again.analysis?.analyzed).toBe(0);
    expect(await snapshot()).toEqual(first);
  });

  it("refuses to reset while a report import holds its lock", async () => {
    for (const entity of REPORT_ENTITIES) {
      await withAdvisoryLock(db as Database, `ingest:${entity}`, async () => {
        await expect(resetDomainTables(db)).rejects.toThrow(
          new RegExp(`ingest run of "${entity}" is in progress`),
        );
      });
    }
    expect(await snapshot()).toEqual(first);
  });
});
