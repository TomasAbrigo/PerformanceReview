import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  identityMatchIssue,
  ingestRun,
  importedRequest,
  questionRevision,
  reviewRequest,
  sourceIdentity,
} from "@/db/schema";
import { getHistoryImportResult } from "./results";
import {
  importReport,
  resetDb,
  seedSmallCompany,
  type SeededCompany,
  writeCsv,
} from "./test-support";

/**
 * Re-importing a corrected raw assessments report (#132): the file is the
 * truth for the rows and cells it has, and the result says what changed.
 */

const PROFILE = "bamboo-assessments-report";
const HEADER = [
  "EEID",
  "Review Period Start",
  "Correo electrónico del trabajo",
  "Employee - What do I do well?",
  "Employee - How could I improve?",
  "Manager - What does [Employee] do well?",
  "Self Assessment Completed Date",
  "Manager Assessment Completed Date",
  "Manager At Time Of Assessment",
]
  .map((h) => `"${h}"`)
  .join(",");

type Row = {
  eeid: string;
  email: string;
  well?: string;
  improve?: string;
  managerWell?: string;
  selfDate?: string;
  managerDate?: string;
  manager?: string;
};
const line = (r: Row) =>
  [
    r.eeid,
    "04/15/2024",
    r.email,
    r.well ?? "",
    r.improve ?? "",
    r.managerWell ?? "",
    r.selfDate ?? "",
    r.managerDate ?? "",
    r.manager ?? "",
  ]
    .map((v) => `"${v}"`)
    .join(",");
const report = (rows: Row[]) => writeCsv([HEADER, ...rows.map(line)]);

const A: Row = {
  eeid: "15",
  email: "marcelo.ibanez@meridian-andina.example",
  well: "Tomé el proyecto Norte.",
  improve: "Liderar reuniones.",
  managerWell: "Aporta ideas.",
  selfDate: "05/15/2024",
  managerDate: "05/21/2024",
  manager: "Santiago Garrido",
};
const B: Row = {
  eeid: "17",
  email: "silvana.arias@meridian-andina.example",
  well: "Documenté el onboarding.",
  improve: "Pedir ayuda antes.",
  managerWell: "Muy prolija.",
  selfDate: "05/20/2024",
  managerDate: "05/21/2024",
  manager: "Marcela Delgado",
};
const C: Row = {
  eeid: "19",
  email: "silvana.molina@meridian-andina.example",
  well: "Cerré el trimestre.",
  improve: "Delegar.",
  managerWell: "Constante.",
  selfDate: "05/17/2024",
  managerDate: "05/20/2024",
  manager: "Marcela Delgado",
};

let seeded: SeededCompany;

async function rejectsOf(runId: string) {
  const [run] = await db
    .select({ rejects: ingestRun.rejects })
    .from(ingestRun)
    .where(eq(ingestRun.id, runId));
  return run.rejects ?? [];
}

async function seedIds() {
  await db.insert(sourceIdentity).values(
    seeded.company.employees.map((e) => ({
      personId: seeded.personOf.get(e.id)!,
      sourceSystem: "bamboo_api" as const,
      kind: "bamboo_id" as const,
      value: e.id,
    })),
  );
}

async function requestsOf(eeid: string) {
  return db
    .select({
      id: reviewRequest.id,
      sourceId: reviewRequest.sourceId,
      relationship: reviewRequest.relationship,
      status: reviewRequest.status,
      submittedAt: reviewRequest.submittedAt,
      requestedAt: reviewRequest.requestedAt,
      mismatch: reviewRequest.reviewerMismatch,
    })
    .from(reviewRequest)
    .where(like(reviewRequest.sourceId, `["${eeid}",%`));
}

async function textsOf(eeid: string) {
  const rows = await db
    .select({ dimension: questionRevision.dimension, text: answer.textValue })
    .from(answer)
    .innerJoin(reviewRequest, eq(reviewRequest.id, answer.requestId))
    .innerJoin(
      questionRevision,
      eq(questionRevision.id, answer.questionRevisionId),
    )
    .where(like(reviewRequest.sourceId, `["${eeid}",%`));
  return rows.map((r) => r.text).sort();
}

beforeEach(async () => {
  await resetDb();
  seeded = await seedSmallCompany();
  await seedIds();
}, 120_000);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("re-importing a corrected report (#132)", () => {
  it("drops the answers whose cells the corrected file leaves empty, the sides it empties and the rows it no longer has", async () => {
    await importReport(await report([A, B, C]), PROFILE);
    expect(await textsOf("15")).toContain("Liderar reuniones.");

    const second = await importReport(
      await report([
        { ...A, improve: "", well: "Tomé el proyecto Norte y Sur." },
        { ...B, managerWell: "", managerDate: "" },
      ]),
      PROFILE,
    );
    expect(second.status).toBe("succeeded");
    expect(await textsOf("15")).toEqual([
      "Aporta ideas.",
      "Tomé el proyecto Norte y Sur.",
    ]);
    expect((await requestsOf("17")).map((r) => r.relationship)).toEqual([
      "self",
    ]);
    expect(await requestsOf("19")).toEqual([]);

    const result = await getHistoryImportResult(db, second.runId!);
    const [cycle] = result!.cycles;
    expect(cycle).toMatchObject({
      rows: 2,
      written: 2,
      issues: 0,
      requestsCreated: 0,
      // A's self side; A's manager side and B's self side are as they were.
      requestsUpdated: 1,
      requestsUnchanged: 2,
      // B's manager side and C's two sides.
      requestsRemoved: 3,
      answersCreated: 0,
      answersUpdated: 1,
      answersRemoved: 1,
      // The open texts of the cycle that no label reads yet (A 2, B 2).
      pendingLabels: 4,
    });
  });

  it("says an answer rewritten with the same value is unchanged, not updated", async () => {
    await importReport(await report([A]), PROFILE);
    // Same answers, another completion date: the request changes, not them.
    const second = await importReport(
      await report([{ ...A, selfDate: "05/16/2024" }]),
      PROFILE,
    );
    const [cycle] = (await getHistoryImportResult(db, second.runId!))!.cycles;
    expect(cycle).toMatchObject({
      requestsUpdated: 1,
      requestsUnchanged: 1,
      answersUpdated: 0,
      answersUnchanged: 3,
    });
  });

  it("never invents a request date for an imported request", async () => {
    await importReport(await report([A]), PROFILE);
    const requests = await requestsOf("15");
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.requestedAt === null)).toBe(true);
  });

  it("counts the rows held for identity apart from the rows written", async () => {
    const outsider: Row = {
      ...A,
      eeid: "90999",
      email: "nobody@example.invalid",
    };
    const run = await importReport(await report([A, outsider]), PROFILE);
    const [cycle] = (await getHistoryImportResult(db, run.runId!))!.cycles;
    expect(cycle).toMatchObject({ rows: 2, written: 1, issues: 1 });
  });

  it("two rows of one person and period: the later completion wins whatever the order, and the other is reported", async () => {
    const early = { ...A, improve: "Antes.", selfDate: "05/10/2024" };
    const late = { ...A, improve: "Después.", selfDate: "05/30/2024" };
    const run = await importReport(await report([late, early]), PROFILE);
    expect(await textsOf("15")).toContain("Después.");
    expect(
      (await rejectsOf(run.runId)).some((r) =>
        /twice|dos veces|repeated/i.test(r.reason),
      ),
    ).toBe(true);
    const [cycle] = (await getHistoryImportResult(db, run.runId!))!.cycles;
    expect(cycle.superseded).toBe(1);
  });

  it("a manager name that matches nobody is flagged as a reviewer mismatch, not silently the snapshot manager", async () => {
    const run = await importReport(
      await report([{ ...A, manager: "Nadie Conocido" }]),
      PROFILE,
    );
    const manager = (await requestsOf("15")).find(
      (r) => r.relationship === "manager",
    )!;
    expect(manager.mismatch).toBe(true);
    const [imported] = await db
      .select()
      .from(importedRequest)
      .where(eq(importedRequest.requestId, manager.id));
    expect(imported.csvReviewerName).toBe("Nadie Conocido");
    expect(
      (await rejectsOf(run.runId)).some((r) =>
        r.reason.includes("Nadie Conocido"),
      ),
    ).toBe(true);
  });

  it("does not place a row by email while its EEID waits in the employee identity queue (a rehire)", async () => {
    const [run] = await db.execute<{ id: string }>(
      sql`insert into ingest_run (source_system, entity, status) values ('bamboo_api', 'employee', 'succeeded') returning id`,
    );
    await db.insert(identityMatchIssue).values({
      ingestRunId: run.id,
      sourceSystem: "bamboo_api",
      entity: "employee",
      sourceId: "741",
      payload: {},
      payloadHash: "x",
      reason: "ambiguous",
      candidates: [],
    });
    const rehire: Row = { ...A, eeid: "741" };
    const result = await importReport(await report([rehire]), PROFILE);
    expect(result.counts.issues).toBe(1);
    expect(await requestsOf("741")).toEqual([]);
    const open = await db
      .select()
      .from(identityMatchIssue)
      .where(
        and(
          eq(identityMatchIssue.entity, "assessment"),
          eq(identityMatchIssue.status, "open"),
        ),
      );
    expect(open).toHaveLength(1);
  });
});
