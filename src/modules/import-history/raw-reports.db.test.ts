import path from "node:path";
import { and, eq, isNotNull, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  answerQualityIssue,
  assessmentProgress,
  identityMatchIssue,
  ingestRun,
  questionRevision,
  reviewCycle,
  reviewRequest,
  sourceIdentity,
} from "@/db/schema";
import type { RunIngestResult } from "@/modules/ingest/run-ingest";
import {
  analyzableSql,
  YES_NO,
} from "@/modules/qualitative-analysis/analysis-text";
import {
  importReport,
  REPORTS,
  resetDb,
  seedSmallCompany,
  type SeededCompany,
  writeCsv,
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

  it("creates the four real custom questions in every cycle (3 self, 1 manager), each with its own dimension", async () => {
    const custom = await db
      .select({
        cycleId: questionRevision.cycleId,
        relationship: questionRevision.appliesTo,
        dimension: questionRevision.dimension,
      })
      .from(questionRevision)
      .where(like(questionRevision.dimension, "custom_%"));
    const perCycle = new Map<string, string[]>();
    for (const c of custom) {
      perCycle.set(c.cycleId, [
        ...(perCycle.get(c.cycleId) ?? []),
        `${c.relationship.join("+")}:${c.dimension}`,
      ]);
    }
    expect(perCycle.size).toBe(5);
    const shapes = new Set(
      [...perCycle.values()].map((s) => [...s].sort().join("|")),
    );
    expect(shapes.size).toBe(1);
    const [shape] = [...shapes];
    expect(shape.split("|")).toHaveLength(4);
    expect(shape).toMatch(
      /^manager:custom_[^|]+\|self:custom_[^|]+\|self:custom_[^|]+\|self:custom_[^|]+$/,
    );
  });

  it("marks the custom questions answered with a yes/no as yes/no questions", async () => {
    const custom = await db
      .select({ yesNo: questionRevision.yesNo })
      .from(questionRevision)
      .where(like(questionRevision.dimension, "custom_%"));
    expect(custom.length).toBeGreaterThan(0);
    expect(custom.every((c) => c.yesNo)).toBe(true);
  });

  it("a bare yes/no answer to a custom question is not a comment to analyse", async () => {
    const rows = await db.execute<{ total: number; analysable: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where ${analyzableSql()})::int as analysable
      from answer a
      join question_revision q on q.id = a.question_revision_id
      where q.dimension like 'custom_%' and btrim(a.text_value) ~* ${YES_NO}`);
    expect(rows[0].total).toBeGreaterThan(20);
    expect(rows[0].analysable).toBe(0);
    const [withHow] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from answer a
      join question_revision q on q.id = a.question_revision_id
      where q.dimension like 'custom_%' and ${analyzableSql()}`);
    expect(withHow.n).toBeGreaterThan(0);
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

describe("edge rows of the raw report (#83)", () => {
  const HEADER =
    "EEID,Review Period Start,Work Email,Employee - What do I do well?,Manager - What does [Employee] do well?,Self Assessment Completed Date,Manager Assessment Completed Date,Manager At Time Of Assessment";

  // Every date has its day <= 12: read as text, so 01/10/2023 is January 10.
  it("drafts answered sides without a date, queues ambiguous managers, explains superseded rows", async () => {
    const [someone, other] = seeded.company.employees;
    const twin = seeded.company.identity.duplicateNames[0];
    expect(twin).toBeDefined();
    const file = await writeCsv([
      HEADER,
      // Answers, no completion date: a draft.
      `${someone.id},01/10/2023,,Ok,,,,`,
      // An ambiguous manager name: the identity queue, no manager review.
      `${other.id},01/10/2023,,Ok,Bien,01/08/2023,01/09/2023,${twin.name}`,
      // The same person again by email, an older self date: superseded.
      `,01/10/2023,${other.workEmail},Viejo,,01/07/2023,,`,
    ]);
    const run = await importReport(file, "bamboo-assessments-report");

    const requests = await db
      .select()
      .from(reviewRequest)
      .innerJoin(reviewCycle, eq(reviewRequest.cycleId, reviewCycle.id))
      .where(eq(reviewCycle.periodStart, "2023-01-10"));

    const draft = requests.find(
      (r) =>
        r.review_request.reviewerPersonId === seeded.personOf.get(someone.id),
    )!;
    expect(draft.review_request).toMatchObject({
      status: "draft",
      submittedAt: null,
    });
    expect(
      requests.filter((r) => r.review_request.relationship === "manager"),
    ).toHaveLength(0);

    const [issue] = await db
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.ingestRunId, run.runId));
    expect(issue.payload).toMatchObject({
      failedRole: "manager",
      failedName: twin.name,
    });
    expect(issue.candidates.length).toBeGreaterThan(1);

    const [stored] = await db
      .select({ rejects: ingestRun.rejects })
      .from(ingestRun)
      .where(eq(ingestRun.id, run.runId));
    expect(JSON.stringify(stored.rejects)).toMatch(/replaces this self review/);
  });
});
