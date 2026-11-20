import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  identityMatchIssue,
  person,
  reviewRequest,
  sourceIdentity,
} from "@/db/schema";
import { resolveIssue } from "@/modules/identity";
import {
  importReport,
  REPORTS,
  resetDb,
  seedSmallCompany,
} from "./test-support";

const REPORT = path.join(REPORTS, "assessments-report.csv");

beforeAll(async () => {
  await resetDb();
  const seeded = await seedSmallCompany();
  await db.insert(sourceIdentity).values(
    seeded.company.employees.map((e) => ({
      personId: seeded.personOf.get(e.id)!,
      sourceSystem: "bamboo_api" as const,
      kind: "bamboo_id" as const,
      value: e.id,
    })),
  );
  await importReport(REPORT, "bamboo-assessments-report");
}, 120_000);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

const openReportIssues = () =>
  db
    .select()
    .from(identityMatchIssue)
    .where(
      and(
        eq(identityMatchIssue.entity, "assessment"),
        eq(identityMatchIssue.status, "open"),
      ),
    );

describe("creating the person of a raw assessments report row (#132)", () => {
  it("creates the person from the row (name, work email, EEID) and imports the row for them", async () => {
    const [issue] = await openReportIssues();
    expect(issue).toBeDefined();
    const fields = (issue.payload as { fields: Record<string, string> }).fields;

    const done = await resolveIssue(db, issue.id, { action: "create" });
    expect(done.status).toBe("resolved");
    const personId = done.resolution?.personId;
    expect(personId).toBeTruthy();

    const [created] = await db
      .select()
      .from(person)
      .where(eq(person.id, personId!));
    expect(created.workEmail).toBe(fields.work_email);
    const ids = await db
      .select()
      .from(sourceIdentity)
      .where(eq(sourceIdentity.personId, personId!));
    expect(ids).toContainEqual(
      expect.objectContaining({
        kind: "bamboo_id",
        value: fields.employee_bamboo_id,
      }),
    );

    const [participant] = await db
      .select()
      .from(cycleParticipant)
      .where(eq(cycleParticipant.revieweePersonId, personId!));
    expect(participant).toBeDefined();
    expect(
      await db.$count(
        reviewRequest,
        eq(reviewRequest.participantId, participant.id),
      ),
    ).toBeGreaterThan(0);
  });

  it("re-importing the file does not raise the case again", async () => {
    const before = (await openReportIssues()).length;
    await importReport(REPORT, "bamboo-assessments-report");
    expect((await openReportIssues()).length).toBeLessThanOrEqual(before);
  });
});
