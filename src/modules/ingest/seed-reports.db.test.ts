import { count, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  assessmentProgress,
  cycleParticipant,
  qualitativeAnalysis,
  reviewCycle,
} from "@/db/schema";
import { seedSystemTemplates } from "@/modules/templates";
import { resetDomainTables, seedFromFixtures } from "./seed";
import { seedAnalysis, seedReports } from "./seed-reports";

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

describe("seed with reports and analysis (small)", () => {
  let first: Awaited<ReturnType<typeof snapshot>>;

  beforeAll(async () => {
    await seedSystemTemplates(db);
    await resetDomainTables(db);
    await seedFromFixtures({ size: "small", db });
    await seedReports({ size: "small", db });
    await seedAnalysis(db);
    first = await snapshot();
  });
  afterAll(async () => {
    await resetDomainTables(db);
    await closeDb();
  });

  it("creates the semi-annual cycles, participants, answers and completion rows", () => {
    expect(first.cycles).toBeGreaterThan(0);
    expect(first.participants).toBeGreaterThan(0);
    expect(first.answers).toBeGreaterThan(0);
    expect(first.progress).toBeGreaterThan(0);
  });

  it("labels the open-text answers with the mock provider", () => {
    expect(first.labels).toBeGreaterThan(0);
  });

  it("is idempotent: a second run changes nothing", async () => {
    await seedFromFixtures({ size: "small", db });
    const reports = await seedReports({ size: "small", db });
    for (const r of reports) {
      expect(r.counts.inserted).toBe(0);
      expect(r.counts.updated).toBe(0);
    }
    const analysis = await seedAnalysis(db);
    expect(analysis.analyzed).toBe(0);
    expect(await snapshot()).toEqual(first);
  });
});
