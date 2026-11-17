import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  assessmentProgress,
  cycleParticipant,
  employeeJobHistory,
  goal,
  identityMatchIssue,
  importedQuestion,
  ingestRun,
  participantGoalSnapshot,
  person,
  questionRevision,
  reviewCycle,
} from "@/db/schema";
import { resumeImportRun, ResumeError } from "@/modules/ingest/resume-run";
import { decisionOf } from "./decision";
import { getBuiltinProfile, type SourceProfile } from "@/modules/lake/profiles";
import { importReport, resetDb, writeCsv } from "./test-support";

/** Issue #58: Assessment Progress, semesters, needs_decision, goals. */

const PERFORMANCE = [
  "Employee Name",
  "Manager",
  "Department",
  "Review Cycle",
  "Assessment Date",
  "Employee Q3: What are some things I do well?",
  "Manager Q3: What are some things [Employee] does well?",
].join(",");

const PROGRESS = [
  "Employee Name",
  "Manager",
  "Department",
  "Review Cycle",
  "Assessed",
  "Self Status",
  "Manager Status",
  "Follow-up Notes",
].join(",");

async function addPerson(displayName: string) {
  const [row] = await db
    .insert(person)
    .values({ displayName })
    .returning({ id: person.id });
  return row.id;
}

async function reportsTo(personId: string, managerPersonId: string) {
  await db.insert(employeeJobHistory).values({
    personId,
    validFrom: "2020-01-01",
    managerPersonId,
    department: "Ingeniería",
  });
}

/** Ana manages Bruno and Carla; Diego manages nobody. */
async function team() {
  const ana = await addPerson("Ana García");
  const bruno = await addPerson("Bruno Pérez");
  const carla = await addPerson("Carla Romero");
  const diego = await addPerson("Diego Sosa");
  await reportsTo(bruno, ana);
  await reportsTo(carla, ana);
  return { ana, bruno, carla, diego };
}

const runOf = async (runId: string) =>
  (await db.select().from(ingestRun).where(eq(ingestRun.id, runId)))[0];

const progressRows = () =>
  db
    .select({
      name: person.displayName,
      self: assessmentProgress.selfStatus,
      manager: assessmentProgress.managerStatus,
      assessed: assessmentProgress.assessed,
      notes: assessmentProgress.followUpNotes,
      mismatch: assessmentProgress.reviewerMismatch,
    })
    .from(assessmentProgress)
    .innerJoin(
      cycleParticipant,
      eq(cycleParticipant.id, assessmentProgress.participantId),
    )
    .innerJoin(person, eq(person.id, cycleParticipant.revieweePersonId))
    .orderBy(person.displayName);

beforeEach(resetDb);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

describe("Assessment Progress import", () => {
  it("records each participant's progress in the named cycle, adding the missing participants", async () => {
    await team();
    await importReport(
      await writeCsv([
        PERFORMANCE,
        "Bruno Pérez,Ana García,Ingeniería,Evaluación 2025-H1,2025-05-20,Ok,Ok",
      ]),
    );

    const { counts, runId } = await importReport(
      await writeCsv([
        PROGRESS,
        "Bruno Pérez,Ana García,Ingeniería,Evaluación 2025-H1,Complete,Submitted,Submitted,",
        "Carla Romero,Diego Sosa,Ingeniería,Evaluación 2025-H1,In Progress,Submitted,Not Started,Pedir reunión",
        "Zoe Nadie,Ana García,Ingeniería,Evaluación 2025-H1,Not Started,Not Started,Not Started,",
      ]),
      "bamboo-assessment-progress",
    );

    expect((await runOf(runId)).status).toBe("succeeded");
    expect(counts).toMatchObject({ read: 3, inserted: 2, issues: 1 });
    expect(await progressRows()).toEqual([
      {
        name: "Bruno Pérez",
        self: "submitted",
        manager: "submitted",
        assessed: true,
        notes: null,
        mismatch: false,
      },
      {
        // The report names Diego, but Ana was her manager at the snapshot.
        name: "Carla Romero",
        self: "submitted",
        manager: "not_started",
        assessed: false,
        notes: "Pedir reunión",
        mismatch: true,
      },
    ]);
    // Carla was not in the cycle yet: added with her as-of snapshot.
    const [cycle] = await db.select().from(reviewCycle);
    expect(
      await db.$count(cycleParticipant, eq(cycleParticipant.cycleId, cycle.id)),
    ).toBe(2);
    // Nobody is called Zoe Nadie: the identity queue has her row.
    const [issue] = await db
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.entity, "assessment_progress"));
    expect(issue.reason).toBe("no_match");
  });

  it("re-importing the same file changes nothing; a newer file of the cycle updates the statuses", async () => {
    await team();
    await importReport(
      await writeCsv([
        PERFORMANCE,
        "Bruno Pérez,Ana García,Ingeniería,Evaluación 2025-H1,2025-05-20,Ok,Ok",
      ]),
    );
    const first = await writeCsv([
      PROGRESS,
      "Bruno Pérez,Ana García,Ingeniería,Evaluación 2025-H1,In Progress,Submitted,In Progress,",
      "Carla Romero,Ana García,Ingeniería,Evaluación 2025-H1,Not Started,Not Started,Not Started,",
    ]);
    await importReport(first, "bamboo-assessment-progress");
    const rows = await db.select().from(assessmentProgress);

    const again = await importReport(first, "bamboo-assessment-progress");
    expect(again.counts).toMatchObject({
      read: 2,
      inserted: 0,
      updated: 0,
      unchanged: 2,
    });
    expect(await db.select().from(assessmentProgress)).toEqual(rows);

    const later = await importReport(
      await writeCsv([
        PROGRESS,
        "Bruno Pérez,Ana García,Ingeniería,Evaluación 2025-H1,Complete,Submitted,Submitted,",
        "Carla Romero,Ana García,Ingeniería,Evaluación 2025-H1,Not Started,Not Started,Not Started,",
      ]),
      "bamboo-assessment-progress",
    );
    expect(later.counts).toMatchObject({ updated: 1, unchanged: 1 });
    expect(await db.$count(assessmentProgress)).toBe(2);
    expect((await progressRows())[0]).toMatchObject({
      name: "Bruno Pérez",
      manager: "submitted",
      assessed: true,
    });
  });

  it("a cycle name that matches no cycle stops the run in needs_decision; choosing one finishes it", async () => {
    await team();
    await importReport(
      await writeCsv([
        PERFORMANCE,
        "Bruno Pérez,Ana García,Ingeniería,Evaluación 2025-H1,2025-05-20,Ok,Ok",
      ]),
    );
    const file = await writeCsv([
      PROGRESS,
      "Bruno Pérez,Ana García,Ingeniería,Primer semestre 2025,Complete,Submitted,Submitted,",
      "Carla Romero,Ana García,Ingeniería,Primer semestre 2025,In Progress,Submitted,Not Started,",
    ]);

    const { runId, counts, status } = await importReport(
      file,
      "bamboo-assessment-progress",
    );

    expect(status).toBe("needs_decision");
    expect(counts).toMatchObject({ read: 2, deferred: 2, inserted: 0 });
    expect(await db.$count(assessmentProgress)).toBe(0);
    const run = await runOf(runId);
    expect(run.status).toBe("needs_decision");
    const decision = decisionOf(run.params)!;
    expect(decision).toMatchObject({
      kind: "cycle",
      rows: 2,
      reasons: ["unknown_cycle"],
      names: ["Primer semestre 2025"],
      proposals: [],
    });
    const [cycle] = await db.select().from(reviewCycle);
    expect(decision.options.map((o) => o.id)).toEqual([cycle.id]);

    await expect(
      resumeImportRun(db, runId, { create: "2031-H1" }),
    ).rejects.toBeInstanceOf(ResumeError);
    expect((await runOf(runId)).status).toBe("needs_decision");

    const resumed = await resumeImportRun(db, runId, { cycleId: cycle.id });

    expect(resumed.counts).toMatchObject({ deferred: 0, inserted: 2 });
    const done = await runOf(runId);
    expect(done.status).toBe("succeeded");
    expect(decisionOf(done.params)?.resolved?.cycleId).toBe(cycle.id);
    expect((await progressRows()).map((r) => r.name)).toEqual([
      "Bruno Pérez",
      "Carla Romero",
    ]);
    await expect(
      resumeImportRun(db, runId, { cycleId: cycle.id }),
    ).rejects.toMatchObject({ code: "not_waiting" });
  });
});

describe("semester cycles of Employee Performance rows without a cycle name", () => {
  it("a clear date goes to its semester's cycle (an imported one that names it, if any)", async () => {
    await team();
    await importReport(
      await writeCsv([
        PERFORMANCE,
        "Bruno Pérez,Ana García,Ingeniería,Evaluación semestral 2025-H1,2025-05-20,Ok,Ok",
      ]),
    );
    const { status } = await importReport(
      await writeCsv([
        PERFORMANCE,
        "Carla Romero,Ana García,Ingeniería,,2025-04-02,Bien,Bien",
        "Bruno Pérez,Ana García,Ingeniería,,2025-09-15,Bien,Bien",
      ]),
    );

    expect(status).toBe("succeeded");
    const cycles = await db
      .select({
        name: reviewCycle.name,
        start: reviewCycle.periodStart,
        end: reviewCycle.periodEnd,
      })
      .from(reviewCycle)
      .orderBy(reviewCycle.periodStart);
    expect(cycles).toEqual([
      {
        name: "Evaluación semestral 2025-H1",
        start: "2025-01-01",
        end: "2025-06-30",
      },
      { name: "2025-H2", start: "2025-07-01", end: "2025-12-31" },
    ]);
  });

  it("a date near a cutoff waits for a decision; creating the proposed semester finishes the run", async () => {
    await team();
    const { runId, status } = await importReport(
      await writeCsv([
        PERFORMANCE,
        "Bruno Pérez,Ana García,Ingeniería,,2025-07-04,Ok,Ok",
        "Carla Romero,Ana García,Ingeniería,,2025-03-10,Ok,Ok",
      ]),
    );

    expect(status).toBe("needs_decision");
    const decision = decisionOf((await runOf(runId)).params)!;
    expect(decision).toMatchObject({
      rows: 1,
      reasons: ["ambiguous_semester"],
      proposals: [
        { name: "2025-H2", periodStart: "2025-07-01", periodEnd: "2025-12-31" },
      ],
    });
    // The clear row was imported meanwhile.
    expect((await db.select().from(reviewCycle)).map((c) => c.name)).toEqual([
      "2025-H1",
    ]);

    await resumeImportRun(db, runId, { create: "2025-H2" });

    expect((await runOf(runId)).status).toBe("succeeded");
    const [h2] = await db
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.name, "2025-H2"));
    expect(h2).toMatchObject({
      periodStart: "2025-07-01",
      periodEnd: "2025-12-31",
      sourceSystem: "bamboo_export",
    });
    expect(
      await db.$count(cycleParticipant, eq(cycleParticipant.cycleId, h2.id)),
    ).toBe(1);
  });
});

describe("goals of imported participants", () => {
  it("each participant gets the goals that overlap the cycle period", async () => {
    const { bruno } = await team();
    await db.insert(goal).values([
      // Imported goals (a native one would start on its creation day, today).
      {
        personId: bruno,
        title: "Migrar reportes",
        dueDate: "2025-05-30",
        sourceSystem: "bamboo_api",
        sourceId: "g1",
      },
      {
        personId: bruno,
        sourceSystem: "bamboo_api",
        sourceId: "g2",
        title: "Meta vieja",
        dueDate: "2024-03-01",
        status: "completed",
        completionDate: "2024-03-01",
      },
    ]);

    await importReport(
      await writeCsv([
        PERFORMANCE,
        "Bruno Pérez,Ana García,Ingeniería,Evaluación 2025-H1,2025-05-20,Ok,Ok",
      ]),
    );

    const snapshots = await db
      .select({
        title: participantGoalSnapshot.title,
        at: participantGoalSnapshot.capturedAt,
      })
      .from(participantGoalSnapshot);
    expect(snapshots.map((s) => s.title)).toEqual(["Migrar reportes"]);
    expect(snapshots[0].at.toISOString().slice(0, 10)).toBe("2025-06-30");
  });
});

describe("configured question mapping", () => {
  it("a custom profile started from the built-in maps any header to a question", async () => {
    await team();
    const builtin = getBuiltinProfile("bamboo-employee-performance")!;
    const profile: SourceProfile = {
      ...builtin,
      name: "perf-cuenta",
      questions: [
        {
          column: "¿Recomendarías trabajar acá?",
          side: "self",
          kind: "likert",
          key: "self:enps",
          dimension: "engagement",
        },
      ],
    };
    await importReport(
      await writeCsv([
        `${PERFORMANCE},¿Recomendarías trabajar acá?`,
        "Bruno Pérez,Ana García,Ingeniería,Evaluación 2025-H1,2025-05-20,Ok,Ok,4",
      ]),
      profile,
    );

    const [mapped] = await db
      .select({ kind: questionRevision.kind, value: answer.optionValue })
      .from(importedQuestion)
      .innerJoin(
        questionRevision,
        eq(questionRevision.id, importedQuestion.questionRevisionId),
      )
      .innerJoin(answer, eq(answer.questionRevisionId, questionRevision.id))
      .where(eq(importedQuestion.columnKey, "self:enps"));
    expect(mapped).toEqual({ kind: "rating", value: 4 });
    // The header pattern still finds the other questions.
    expect(await db.$count(importedQuestion)).toBe(3);
  });
});
