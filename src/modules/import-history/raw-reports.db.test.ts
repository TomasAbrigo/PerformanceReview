import path from "node:path";
import { and, eq, isNotNull, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  answerQualityIssue,
  assessmentProgress,
  identityMatchIssue,
  questionRevision,
  reviewCycle,
  reviewRequest,
  sourceIdentity,
} from "@/db/schema";
import type { RunIngestResult } from "@/modules/ingest/run-ingest";
import {
  importReport,
  REPORTS,
  resetDb,
  seedSmallCompany,
  type SeededCompany,
} from "./test-support";

const REPORT = path.join(REPORTS, "assessments-report.csv");
const STATUS = path.join(REPORTS, "assessment-status.csv");

let seeded: SeededCompany;
let first: RunIngestResult;
let status: RunIngestResult;

beforeAll(async () => {
  await resetDb();
  seeded = await seedSmallCompany();
  // The ids the Bamboo API ingest keeps: EEID and employee number.
  await db.insert(sourceIdentity).values(
    seeded.company.employees.flatMap((e) => [
      {
        personId: seeded.personOf.get(e.id)!,
        sourceSystem: "bamboo_api" as const,
        kind: "bamboo_id" as const,
        value: e.id,
      },
    ]),
  );
  const numbers = new Map<string, string>();
  for (const e of seeded.company.employees) {
    numbers.set(e.employeeNumber, seeded.personOf.get(e.id)!);
  }
  await db
    .insert(sourceIdentity)
    .values(
      [...numbers].map(([value, personId]) => ({
        personId,
        sourceSystem: "bamboo_api" as const,
        kind: "employee_number" as const,
        value,
      })),
    )
    .onConflictDoNothing();
  first = await importReport(REPORT, "bamboo-assessments-report");
  status = await importReport(STATUS, "bamboo-assessment-status");
}, 120_000);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("Bamboo's raw assessments report (#83)", () => {
  it("creates one cycle per review period start, named by its period", async () => {
    expect(first.status).toBe("succeeded");
    expect(first.counts.rejected).toBe(0);
    const cycles = await db
      .select()
      .from(reviewCycle)
      .orderBy(reviewCycle.periodStart);
    expect(cycles.map((c) => [c.periodStart, c.periodEnd])).toEqual([
      ["2024-04-15", "2024-09-28"],
      ["2024-09-29", "2025-03-28"],
      ["2025-03-29", "2025-09-28"],
      ["2025-09-29", "2026-03-28"],
      ["2026-03-29", "2026-09-28"],
    ]);
    expect(cycles[0].name).toBe("Evaluación semestral 2024-04-15 – 2024-09-28");
    expect(cycles.every((c) => c.snapshotDate === c.periodStart)).toBe(true);
  });

  it("matches people by EEID: only outsiders go to the identity queue", async () => {
    const outsiders = seeded.company.identity.outsiders.filter(
      (o) => o.report === "employee-performance",
    ).length;
    expect(first.counts.issues ?? 0).toBe(outsiders);
  });

  it("creates custom questions per cycle, different between cycles", async () => {
    const custom = await db
      .select({
        cycleId: questionRevision.cycleId,
        dimension: questionRevision.dimension,
      })
      .from(questionRevision)
      .where(like(questionRevision.dimension, "custom_%"));
    const perCycle = new Map<string, Set<string>>();
    for (const c of custom) {
      perCycle.set(
        c.cycleId,
        (perCycle.get(c.cycleId) ?? new Set()).add(c.dimension!),
      );
    }
    const sets = [...perCycle.values()].map((s) => [...s].sort().join("|"));
    expect(perCycle.size).toBe(5);
    expect(new Set(sets).size).toBeGreaterThan(2);
  });

  it("normalizes retention, engagement and valued; flags an unknown label", async () => {
    const values = await db
      .select({ role: questionRevision.role, value: answer.optionValue })
      .from(answer)
      .innerJoin(
        questionRevision,
        eq(answer.questionRevisionId, questionRevision.id),
      )
      .where(isNotNull(questionRevision.role));
    for (const role of ["retention", "engagement", "valued"] as const) {
      const mine = values.filter((v) => v.role === role);
      expect(mine.length).toBeGreaterThan(20);
      const max = role === "valued" ? 4 : 5;
      expect(
        mine.every((v) => v.value === null || (v.value >= 1 && v.value <= max)),
      ).toBe(true);
    }
    const issues = await db.select().from(answerQualityIssue);
    expect(issues.map((i) => i.rawValue)).toContain("Hard to say yet.");
  });

  it("keeps the self side of rows without a manager side, and flags mismatches", async () => {
    const self = await db.$count(
      reviewRequest,
      eq(reviewRequest.relationship, "self"),
    );
    const manager = await db.$count(
      reviewRequest,
      eq(reviewRequest.relationship, "manager"),
    );
    expect(self).toBeGreaterThan(manager);
    expect(
      await db.$count(
        reviewRequest,
        and(
          eq(reviewRequest.relationship, "manager"),
          eq(reviewRequest.reviewerMismatch, true),
        ),
      ),
    ).toBeGreaterThan(0);
  });

  it("stores Other with its text", async () => {
    const others = await db
      .select({ text: answer.textValue })
      .from(answer)
      .where(eq(answer.optionLabel, "other"));
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((o) => o.text && !/^other/i.test(o.text))).toBe(true);
  });

  it("is idempotent", async () => {
    const again = await importReport(REPORT, "bamboo-assessments-report");
    expect(again.counts.inserted).toBe(0);
    expect(again.counts.updated).toBe(0);
  });
});

describe("Assessment Progress as exported, grouped (#83)", () => {
  it("imports every period row into the cycle of its period", async () => {
    expect(status.status).toBe("succeeded");
    expect(status.counts.rejected).toBe(0);
    expect(status.counts.issues ?? 0).toBe(0);
    const rows = await db.select().from(assessmentProgress);
    expect(rows.length).toBe(status.counts.read);
    expect(rows.some((r) => r.selfStatus === "in_progress")).toBe(true);
    expect(rows.some((r) => r.managerStatus === "not_started")).toBe(true);
    expect(await db.$count(reviewCycle)).toBe(5);
  });

  it("is idempotent", async () => {
    const again = await importReport(STATUS, "bamboo-assessment-status");
    expect(again.counts.inserted).toBe(0);
    expect(again.counts.updated).toBe(0);
    expect(await db.$count(identityMatchIssue)).toBeGreaterThan(0);
  });
});
