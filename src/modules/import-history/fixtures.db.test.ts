import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  cycleParticipant,
  identityMatchIssue,
  importedRequest,
  questionRevision,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import { groupJobRows, rowOnDate } from "@/fixtures/company/job-history";
import type { RunIngestResult } from "@/modules/ingest/run-ingest";
import {
  importReport,
  REPORTS,
  resetDb,
  seedSmallCompany,
  type SeededCompany,
} from "./test-support";

const PERFORMANCE = path.join(REPORTS, "employee-performance.csv");
const FEEDBACK = path.join(REPORTS, "feedback-status.csv");

let seeded: SeededCompany;
let first: RunIngestResult;

const tableCounts = async () => ({
  cycles: await db.$count(reviewCycle),
  participants: await db.$count(cycleParticipant),
  revisions: await db.$count(questionRevision),
  requests: await db.$count(reviewRequest),
  answers: await db.$count(answer),
  issues: await db.$count(identityMatchIssue),
});

beforeAll(async () => {
  await resetDb();
  seeded = await seedSmallCompany();
  first = await importReport(PERFORMANCE);
}, 60_000);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("importing the small Employee Performance report", () => {
  it("creates the 3 historical cycles, closed, with participants, requests and answers", async () => {
    expect(first.counts).toMatchObject({ read: 69, rejected: 0 });
    expect(first.counts.inserted + (first.counts.issues ?? 0)).toBe(69);

    const cycles = await db.select().from(reviewCycle);
    expect(cycles.map((c) => c.name).sort()).toEqual(
      seeded.company.cycles.map((c) => c.name),
    );
    for (const cycle of cycles) {
      expect(cycle).toMatchObject({
        status: "closed",
        sourceSystem: "bamboo_export",
        templateId: null,
      });
      expect(cycle.periodEnd).toBe(cycle.snapshotDate);
      // Assessment dates fall in the assessment window of that year.
      expect(cycle.periodStart.slice(0, 4)).toBe(cycle.name.slice(-4));
      const participants = await db.$count(
        cycleParticipant,
        eq(cycleParticipant.cycleId, cycle.id),
      );
      expect(participants).toBeGreaterThan(5);
      expect(
        await db.$count(
          questionRevision,
          eq(questionRevision.cycleId, cycle.id),
        ),
      ).toBe(12);
    }
    const counts = await tableCounts();
    expect(counts.requests).toBeGreaterThan(counts.participants);
    expect(counts.answers).toBeGreaterThan(counts.requests * 5);
  });

  it("freezes each participant's manager as of period end, not today's", async () => {
    const { company, personOf } = seeded;
    const rows = groupJobRows(company.jobHistory);
    const employeeOf = new Map<string, string>();
    for (const [employeeId, personId] of personOf) {
      // The latest record of each human (rehires share a person).
      employeeOf.set(personId, employeeId);
    }
    const participants = await db
      .select({ p: cycleParticipant, end: reviewCycle.periodEnd })
      .from(cycleParticipant)
      .innerJoin(reviewCycle, eq(reviewCycle.id, cycleParticipant.cycleId));
    let checked = 0;
    for (const { p, end } of participants) {
      const employeeId = employeeOf.get(p.revieweePersonId)!;
      const job = rowOnDate(rows, employeeId, end);
      if (!job) continue;
      expect(p.snapshotAsOf).toBe(end);
      expect(p.snapManagerPersonId).toBe(
        job.managerId ? personOf.get(job.managerId) : null,
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("flags manager reviews whose CSV manager (today's) differs from the one in force", async () => {
    const flagged = await db
      .select({
        reviewer: reviewRequest.reviewerPersonId,
        snap: cycleParticipant.snapManagerPersonId,
        mismatch: importedRequest.reviewerMismatch,
      })
      .from(importedRequest)
      .innerJoin(reviewRequest, eq(reviewRequest.id, importedRequest.requestId))
      .innerJoin(
        cycleParticipant,
        eq(cycleParticipant.id, reviewRequest.participantId),
      )
      .where(eq(reviewRequest.relationship, "manager"));
    const mismatched = flagged.filter((f) => f.mismatch);
    expect(mismatched.length).toBeGreaterThan(0);
    expect(mismatched.length).toBeLessThan(flagged.length);
    for (const f of flagged) expect(f.mismatch).toBe(f.reviewer !== f.snap);
    expect(first.counts.mismatches).toBe(mismatched.length);
  });

  it("sends unknown and ambiguous names to the identity queue and counts them", async () => {
    const issues = await db
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.entity, "assessment"));
    expect(issues.length).toBe(first.counts.issues);
    const names = issues.map(
      (i) =>
        (i.payload as { fields: { employee_name: string } }).fields
          .employee_name,
    );
    const { identity } = seeded.company;
    for (const outsider of identity.outsiders) {
      if (outsider.report === "employee-performance") {
        expect(names).toContain(outsider.name);
      }
    }
    for (const typo of identity.misspellings) {
      expect(names).toContain(typo.csvName);
    }
    for (const dup of identity.duplicateNames) {
      const issue = issues.find(
        (i) =>
          (i.payload as { fields: { employee_name: string } }).fields
            .employee_name === dup.name,
      );
      if (issue) expect(issue.reason).toBe("ambiguous");
    }
  });

  it("maps standard letters to their choices and custom 1-5 ratings to normalized values", async () => {
    const rows = await db
      .select({ a: answer, q: questionRevision })
      .from(answer)
      .innerJoin(
        questionRevision,
        eq(questionRevision.id, answer.questionRevisionId),
      );
    const choiceAnswers = rows.filter(({ q }) => q.kind === "single_choice");
    expect(choiceAnswers.length).toBeGreaterThan(0);
    for (const { a, q } of choiceAnswers) {
      expect(q.choices?.map((c) => c.value)).toContain(a.optionLabel);
    }
    const ratings = rows.filter(({ q }) => q.kind === "rating");
    expect(ratings.length).toBeGreaterThan(0);
    for (const { a } of ratings) {
      expect(a.normalized).toBe(((a.optionValue ?? 0) - 1) / 4);
    }
    const hidden = await db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.visibleToReviewee, false));
    expect(hidden.map((q) => q.prompt.en).sort()).toEqual(
      [
        "How engaged is [Employee] at work?",
        "If [Employee] got a job offer elsewhere, I would...",
      ].flatMap((p) => [p, p, p]),
    );
  });

  it("re-importing the same file creates nothing new", async () => {
    const before = await tableCounts();

    const again = await importReport(PERFORMANCE);

    expect(again.counts).toMatchObject({ read: 69, inserted: 0, updated: 0 });
    expect(again.counts.unchanged + (again.counts.issues ?? 0)).toBe(69);
    expect(await tableCounts()).toEqual(before);
  }, 60_000);
});

describe("importing the small Feedback Status report", () => {
  it("creates peer requests (submitted or declined) without answers", async () => {
    const { counts } = await importReport(FEEDBACK, "bamboo-feedback-status");
    expect(counts.read).toBe(220);
    expect(counts.inserted).toBeGreaterThan(100);
    expect(await db.$count(reviewCycle)).toBe(3);

    const peers = await db
      .select()
      .from(reviewRequest)
      .where(eq(reviewRequest.relationship, "peer"));
    expect(peers.length).toBe(counts.inserted);
    const submitted = peers.filter((p) => p.status === "submitted");
    expect(submitted.length).toBeGreaterThan(0);
    expect(submitted.length).toBeLessThan(peers.length);
    expect(peers.filter((p) => p.status === "declined").length).toBe(
      peers.length - submitted.length,
    );
    const peerAnswers = await db
      .select({ id: answer.id })
      .from(answer)
      .innerJoin(reviewRequest, eq(reviewRequest.id, answer.requestId))
      .where(eq(reviewRequest.relationship, "peer"));
    expect(peerAnswers).toEqual([]);

    const reviewerOutsiders = seeded.company.identity.outsiders
      .filter((o) => o.report === "feedback-status")
      .map((o) => o.name);
    const issues = await db
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.entity, "feedback"));
    const reviewerNames = issues.map(
      (i) =>
        (i.payload as { fields: { reviewer_name: string } }).fields
          .reviewer_name,
    );
    for (const name of reviewerOutsiders) expect(reviewerNames).toContain(name);
  }, 60_000);
});
