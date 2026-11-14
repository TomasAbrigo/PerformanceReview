import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  cycleParticipant,
  employeeJobHistory,
  importedRequest,
  person,
  questionRevision,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import { importReport, resetDb, writeCsv } from "./test-support";

const HEADER = [
  "Employee Name",
  "Manager",
  "Department",
  "Review Cycle",
  "Assessment Date",
  "Employee Q1: How well does Acme recognize my value?",
  "Employee Q3: What are some things I do well?",
  '"Manager Q1: If [Employee] got a job offer elsewhere, I would..."',
  "Manager Q3: What are some things [Employee] does well?",
  "Employee Custom Q1: Mis objetivos están claros.",
  "Manager Custom Q1: Los objetivos de [Employee] están claros.",
].join(",");

async function addPerson(displayName: string) {
  const [row] = await db
    .insert(person)
    .values({ displayName })
    .returning({ id: person.id });
  return row.id;
}

async function job(personId: string, from: string, managerPersonId: string) {
  await db.insert(employeeJobHistory).values({
    personId,
    validFrom: from,
    managerPersonId,
    department: "Ingeniería",
    jobTitle: "Developer",
    location: "Córdoba",
  });
}

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("assessment import: one row", () => {
  it("creates a closed imported cycle, the participant with its as-of snapshot, both requests and their answers", async () => {
    const ana = await addPerson("Ana García");
    const bruno = await addPerson("Bruno Pérez");
    await job(bruno, "2020-01-01", ana);
    const file = await writeCsv([
      HEADER,
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-01,B,Cumplo,A,Es confiable,4,5",
    ]);

    const { counts } = await importReport(file);

    expect(counts).toMatchObject({ read: 1, inserted: 1, rejected: 0 });
    const [cycle] = await db.select().from(reviewCycle);
    expect(cycle).toMatchObject({
      name: "Ciclo 2023",
      status: "closed",
      sourceSystem: "bamboo_export",
      sourceId: "Ciclo 2023",
      periodStart: "2023-12-01",
      periodEnd: "2023-12-01",
      snapshotDate: "2023-12-01",
      templateId: null,
    });
    const [participant] = await db.select().from(cycleParticipant);
    expect(participant).toMatchObject({
      cycleId: cycle.id,
      revieweePersonId: bruno,
      snapshotAsOf: "2023-12-01",
      snapManagerPersonId: ana,
      snapDepartment: "Ingeniería",
      snapJobTitle: "Developer",
      snapLocation: "Córdoba",
    });

    const requests = await db.select().from(reviewRequest);
    expect(
      requests
        .map((r) => [r.relationship, r.reviewerPersonId, r.status])
        .sort(),
    ).toEqual([
      ["manager", ana, "submitted"],
      ["self", bruno, "submitted"],
    ]);
    expect(requests[0].submittedAt?.toISOString().slice(0, 10)).toBe(
      "2023-12-01",
    );
    expect(requests.every((r) => r.sourceSystem === "bamboo_export")).toBe(
      true,
    );

    const revisions = await db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.cycleId, cycle.id));
    expect(revisions).toHaveLength(6);

    const manager = requests.find((r) => r.relationship === "manager")!;
    const answers = await db
      .select({ a: answer, q: questionRevision })
      .from(answer)
      .innerJoin(
        questionRevision,
        eq(questionRevision.id, answer.questionRevisionId),
      )
      .where(eq(answer.requestId, manager.id));
    const byPrompt = new Map(answers.map(({ a, q }) => [q.prompt.en, a]));
    expect(
      byPrompt.get("If [Employee] got a job offer elsewhere, I would..."),
    ).toMatchObject({ optionLabel: "A" });
    expect(
      byPrompt.get("What are some things [Employee] does well?"),
    ).toMatchObject({ textValue: "Es confiable" });
    expect(
      byPrompt.get("Los objetivos de [Employee] están claros."),
    ).toMatchObject({ optionValue: 5, normalized: 1 });

    const [flag] = await db
      .select()
      .from(importedRequest)
      .where(eq(importedRequest.requestId, manager.id));
    expect(flag).toMatchObject({
      csvReviewerName: "Ana García",
      reviewerMismatch: false,
    });
  });

  it("uses the manager in force at period end and flags a CSV manager that differs", async () => {
    const ana = await addPerson("Ana García");
    const carla = await addPerson("Carla Romero");
    const bruno = await addPerson("Bruno Pérez");
    await job(bruno, "2020-01-01", ana);
    // Carla took over after the cycle: the export prints her (the current one).
    await db
      .update(employeeJobHistory)
      .set({ validTo: "2024-03-01" })
      .where(eq(employeeJobHistory.personId, bruno));
    await job(bruno, "2024-03-01", carla);
    const file = await writeCsv([
      HEADER,
      "Bruno Pérez,Carla Romero,Ingeniería,Ciclo 2023,2023-12-01,B,Cumplo,A,Es confiable,4,5",
    ]);

    const { runId } = await importReport(file);

    const [participant] = await db.select().from(cycleParticipant);
    expect(participant.snapManagerPersonId).toBe(ana);
    const [manager] = await db
      .select()
      .from(reviewRequest)
      .where(eq(reviewRequest.relationship, "manager"));
    expect(manager.reviewerPersonId).toBe(carla);
    const [flag] = await db
      .select()
      .from(importedRequest)
      .where(eq(importedRequest.requestId, manager.id));
    expect(flag.reviewerMismatch).toBe(true);
    const { getRun } = await import("@/modules/ingest/runs-queries");
    const run = await getRun(db, runId);
    expect(run?.rejects).toEqual([
      expect.objectContaining({ code: "reviewer_mismatch" }),
    ]);
  });

  it("re-importing the same file creates nothing new", async () => {
    const ana = await addPerson("Ana García");
    const bruno = await addPerson("Bruno Pérez");
    await job(bruno, "2020-01-01", ana);
    const file = await writeCsv([
      HEADER,
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-01,B,Cumplo,A,Es confiable,4,5",
    ]);
    await importReport(file);

    const { counts } = await importReport(file);

    expect(counts).toMatchObject({ read: 1, inserted: 0, unchanged: 1 });
    expect(await db.$count(reviewCycle)).toBe(1);
    expect(await db.$count(questionRevision)).toBe(6);
    expect(await db.$count(reviewRequest)).toBe(2);
    expect(await db.$count(answer)).toBe(6);
  });

  it("a name that matches nobody (or two people) goes to the identity queue and is counted", async () => {
    const ana = await addPerson("Ana García");
    await addPerson("Bruno Pérez");
    await addPerson("Bruno Perez");
    const file = await writeCsv([
      HEADER,
      "Zoe Nadie,Ana García,Ingeniería,Ciclo 2023,2023-12-01,B,Cumplo,A,Ok,4,5",
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-02,B,Cumplo,A,Ok,4,5",
    ]);

    const { counts } = await importReport(file);

    expect(counts).toMatchObject({ read: 2, issues: 2, inserted: 0 });
    const { identityMatchIssue } = await import("@/db/schema");
    const issues = await db.select().from(identityMatchIssue);
    expect(issues.map((i) => [i.entity, i.reason]).sort()).toEqual([
      ["assessment", "ambiguous"],
      ["assessment", "no_match"],
    ]);
    expect(
      issues.find((i) => i.reason === "ambiguous")!.candidates,
    ).toHaveLength(2);
    // The cycle exists all the same; nobody was made a participant.
    expect(await db.$count(reviewCycle)).toBe(1);
    expect(await db.$count(cycleParticipant)).toBe(0);
    expect(ana).toBeTruthy();
  });

  it("the cycle period spans the assessment dates seen", async () => {
    const ana = await addPerson("Ana García");
    const bruno = await addPerson("Bruno Pérez");
    const carla = await addPerson("Carla Romero");
    await job(bruno, "2020-01-01", ana);
    await job(carla, "2020-01-01", ana);
    const file = await writeCsv([
      HEADER,
      "Bruno Pérez,Ana García,Ingeniería,Ciclo 2023,2023-12-09,B,Cumplo,A,Ok,4,5",
      "Carla Romero,Ana García,Ingeniería,Ciclo 2023,2023-11-28,B,Cumplo,A,Ok,4,5",
    ]);

    await importReport(file);

    const [cycle] = await db
      .select()
      .from(reviewCycle)
      .where(and(eq(reviewCycle.sourceId, "Ciclo 2023")));
    expect(cycle).toMatchObject({
      periodStart: "2023-11-28",
      periodEnd: "2023-12-09",
      snapshotDate: "2023-12-09",
    });
    const participants = await db.select().from(cycleParticipant);
    expect(participants.map((p) => p.snapshotAsOf)).toEqual([
      "2023-12-09",
      "2023-12-09",
    ]);
  });
});
