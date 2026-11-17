import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleGoalLink,
  cycleParticipant,
  goal,
  participantGoalSnapshot,
  person,
  question,
  questionRevision,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import {
  cloneTemplate,
  listTemplates,
  seedSystemTemplates,
} from "@/modules/templates";
import { getReview } from ".";
import {
  isGoalsQuestion,
  overallRatingQuestion,
  snapshotGoalsForParticipant,
} from "./goal-snapshot";
import {
  createTestCycle,
  requestIdOf,
  type TestCycleInput,
} from "./test-support";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

// As of 2022-06-01: Bruno reports to Carla, Carla to Ana, Ana to nobody.
let ana: string;
let bruno: string;
let carla: string;
let templateId: string;

const as = (
  personId: string,
  role: ActorContext["role"] = "employee",
): ActorContext => ({ personId, role });

async function reset() {
  await db.execute(
    sql`TRUNCATE review_cycle, goal, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

const idOf = async (name: string) =>
  (
    await db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.displayName, name))
  )[0].id;

beforeAll(async () => {
  await seedSystemTemplates(db);
  templateId = (await listTemplates(db)).find(
    (t) => t.isSystem && t.enabled,
  )!.id;
});

beforeEach(async () => {
  await reset();
  const dir = await mkdtemp(path.join(tmpdir(), "goal-snapshot-"));
  await cp(FIXTURES, dir, { recursive: true });
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runIngest({ adapter, entity: "job_history", db });
  await rm(dir, { recursive: true, force: true });
  [ana, bruno, carla] = await Promise.all(
    ["Ana García", "Bruno Pérez", "Carla Romero"].map(idOf),
  );
});

afterAll(async () => {
  await reset();
  await closeDb();
});

/** Bruno and Ana's H1 2022 cycle (collecting) from the system template. */
const collectingCycle = (overrides: Partial<TestCycleInput> = {}) =>
  createTestCycle({ templateId, personIds: [ana, bruno], ...overrides });

type GoalSeed = Partial<typeof goal.$inferInsert> & {
  title: string;
  personId: string;
};

/** A goal of someone (Bamboo-sourced, so it has a source id like the real ones). */
let seq = 0;
async function addGoal(seed: GoalSeed) {
  seq += 1;
  const [row] = await db
    .insert(goal)
    .values({
      sourceSystem: "bamboo_api",
      sourceId: `g${seq}`,
      percentComplete: 10,
      status: "in_progress",
      ...seed,
    })
    .returning();
  return row;
}

const participantOf = async (cycleId: string, personId: string) =>
  (
    await db
      .select()
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycleId),
          eq(cycleParticipant.revieweePersonId, personId),
        ),
      )
  )[0];

/**
 * The snapshot rows by title, ordered here by code unit: the database's own
 * collation (locale aware or not) decides "C runs" vs "Created" differently
 * from one Postgres install to another.
 */
const snapshotOf = async (participantId: string) =>
  (
    await db
      .select()
      .from(participantGoalSnapshot)
      .where(eq(participantGoalSnapshot.participantId, participantId))
  ).sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

/** Goals for the overlap scenarios (period 2022-01-01..2022-06-30). */
async function seedGoals() {
  const dueInside = await addGoal({
    personId: bruno,
    title: "A due inside",
    dueDate: "2022-03-01",
    percentComplete: 40,
  });
  await addGoal({
    personId: bruno,
    title: "B due before",
    dueDate: "2021-12-01",
  });
  await addGoal({
    personId: bruno,
    title: "C runs past the period",
    dueDate: "2022-12-31",
    percentComplete: 25,
  });
  await addGoal({
    personId: bruno,
    title: "D closed, no date",
    status: "closed",
  });
  await addGoal({
    personId: bruno,
    title: "E deleted",
    dueDate: "2022-04-01",
    deletedAt: new Date(),
  });
  await addGoal({ personId: ana, title: "F of Ana", dueDate: "2022-05-01" });
  await addGoal({
    personId: carla,
    title: "G of Carla",
    dueDate: "2022-05-01",
  });
  return { dueInside };
}

describe("snapshot at launch", () => {
  it("holds exactly the goals that overlap the period, as they were", async () => {
    await seedGoals();
    const cycle = await collectingCycle();

    const forBruno = await snapshotOf(
      (await participantOf(cycle.id, bruno)).id,
    );
    expect(titles(forBruno)).toEqual([
      "A due inside",
      "C runs past the period",
    ]);
    expect(forBruno[0]).toMatchObject({
      status: "in_progress",
      percentComplete: 40,
      dueDate: "2022-03-01",
      noLongerApplicable: false,
      refreshedAt: null,
    });
    expect(forBruno[0].capturedAt).toBeInstanceOf(Date);
    expect(forBruno[0].goalSourceKey).toMatch(/^bamboo_api:g\d+$/);
    expect(forBruno[0].goalId).not.toBeNull();

    const forAna = await snapshotOf((await participantOf(cycle.id, ana)).id);
    expect(titles(forAna)).toEqual(["F of Ana"]);
  });

  it("falls back to the goal id as source id for native goals", async () => {
    const native = await addGoal({
      personId: bruno,
      title: "Native",
      dueDate: "2022-03-01",
      sourceSystem: "native",
      sourceId: null,
      createdAt: new Date("2022-02-01T00:00:00Z"),
    });
    const cycle = await collectingCycle();
    const [row] = await snapshotOf((await participantOf(cycle.id, bruno)).id);
    expect(row.goalSourceKey).toBe(`native:${native.id}`);
  });

  it("leaves out a native goal created after the period ended", async () => {
    await addGoal({
      personId: bruno,
      title: "Native, later",
      dueDate: "2022-12-31",
      sourceSystem: "native",
      sourceId: null,
      createdAt: new Date("2022-08-01T00:00:00Z"),
    });
    const cycle = await collectingCycle();
    expect(await snapshotOf((await participantOf(cycle.id, bruno)).id)).toEqual(
      [],
    );
  });

  it("never adds a goal created after the launch", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const bruno1 = await participantOf(cycle.id, bruno);
    await addGoal({ personId: bruno, title: "Late", dueDate: "2022-05-01" });

    expect(titles(await snapshotOf(bruno1.id))).toEqual([
      "A due inside",
      "C runs past the period",
    ]);
  });

  it("keeps two goals that share a source id across source systems", async () => {
    await addGoal({
      personId: bruno,
      title: "From the API",
      dueDate: "2022-03-01",
      sourceSystem: "bamboo_api",
      sourceId: "9001",
    });
    await addGoal({
      personId: bruno,
      title: "From the export",
      dueDate: "2022-04-01",
      sourceSystem: "bamboo_export",
      sourceId: "9001",
    });
    const cycle = await collectingCycle();
    const rows = await snapshotOf((await participantOf(cycle.id, bruno)).id);
    expect(rows.map((r) => r.goalSourceKey).sort()).toEqual([
      "bamboo_api:9001",
      "bamboo_export:9001",
    ]);
  });

  it("dates a native goal's start in the company's time zone", async () => {
    // 22:30 on 2022-06-30 in Buenos Aires is already 2022-07-01 in UTC.
    await addGoal({
      personId: bruno,
      title: "Native, last evening",
      dueDate: "2022-12-31",
      sourceSystem: "native",
      sourceId: null,
      createdAt: new Date("2022-07-01T01:30:00Z"),
    });
    const cycle = await collectingCycle();
    expect(
      titles(await snapshotOf((await participantOf(cycle.id, bruno)).id)),
    ).toEqual(["Native, last evening"]);
  });

  it("snapshotGoalsForParticipant takes the capture date it is given", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await snapshotGoalsForParticipant(
      db,
      p.id,
      new Date("2022-06-15T12:00:00Z"),
    );
    const rows = await snapshotOf(p.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].capturedAt.toISOString()).toBe("2022-06-15T12:00:00.000Z");
  });
});

describe("goals linked to the cycle (cycle_goal_link)", () => {
  it("join the snapshot even outside the period", async () => {
    const old = await addGoal({
      personId: bruno,
      title: "Old but linked",
      dueDate: "2020-01-01",
    });
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    expect(titles(await snapshotOf(p.id))).toEqual([]);
    await db
      .insert(cycleGoalLink)
      .values({ cycleId: cycle.id, goalId: old.id });
    await snapshotGoalsForParticipant(db, p.id);
    expect(titles(await snapshotOf(p.id))).toEqual(["Old but linked"]);
  });
});

describe("goals rating", () => {
  const revisionsOf = (cycleId: string) =>
    db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.cycleId, cycleId));

  it("marks the goals rating and its comment apart from the overall rating", async () => {
    const cycle = await collectingCycle();
    const revisions = await revisionsOf(cycle.id);
    const byRole = (role: string) => revisions.filter((r) => r.role === role);
    expect(byRole("goals_rating")).toHaveLength(1);
    expect(byRole("goals_rating")[0]).toMatchObject({
      kind: "rating",
      appliesTo: ["manager"],
    });
    expect(byRole("goals_comment")).toHaveLength(1);
    expect(byRole("goals_comment")[0].kind).toBe("text");
    const overall = revisions.find(
      (r) => r.prompt.en === "Overall performance rating",
    )!;
    expect(overall.role).toBe("overall_rating");
    expect(overallRatingQuestion(revisions)?.id).toBe(overall.id);
    expect(revisions.filter((r) => r.role === null).length).toBe(
      revisions.length - 3,
    );
  });

  it("has no overall rating question when no revision carries the role", () => {
    expect(
      overallRatingQuestion([{ role: null }, { role: "goals_rating" }]),
    ).toBeUndefined();
  });

  it("keeps the roles when a template is cloned", async () => {
    const copy = await cloneTemplate(db, templateId, {
      name: { es: "Copia", en: "Copy" },
    });
    const cycle = await collectingCycle({ templateId: copy.id });
    expect(
      (await revisionsOf(cycle.id)).filter((r) => r.role === "goals_rating"),
    ).toHaveLength(1);
  });

  const managerReview = async (cycleId: string) => {
    const p = await participantOf(cycleId, bruno);
    const requestId = await requestIdOf(p.id, "manager");
    return (await getReview(db, as(carla, "manager"), requestId))!;
  };

  it("is optional, with its comment, when the participant has no goals", async () => {
    const cycle = await collectingCycle(); // nobody has goals
    const review = await managerReview(cycle.id);
    const goalsQuestions = review.questions.filter(isGoalsQuestion);
    expect(goalsQuestions).toHaveLength(2);
    expect(goalsQuestions.every((q) => !q.required)).toBe(true);
    expect(
      review.questions
        .filter((q) => !isGoalsQuestion(q))
        .every((q) => q.required),
    ).toBe(true);
  });

  it("is optional when every snapshot goal no longer applies", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await db
      .update(participantGoalSnapshot)
      .set({ noLongerApplicable: true })
      .where(eq(participantGoalSnapshot.participantId, p.id));
    const review = await managerReview(cycle.id);
    expect(
      review.questions.filter(isGoalsQuestion).every((q) => !q.required),
    ).toBe(true);
  });

  it("is required when the participant has goals", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const review = await managerReview(cycle.id);
    expect(
      review.questions.filter(isGoalsQuestion).every((q) => q.required),
    ).toBe(true);
  });

  it("does not change the other reviews' required questions", async () => {
    const cycle = await collectingCycle();
    const selfRevisions = (await revisionsOf(cycle.id)).filter((r) =>
      r.appliesTo.includes("self"),
    );
    expect(selfRevisions.every((r) => r.role === null)).toBe(true);
  });
});

describe("role backfill (migration)", () => {
  /** The backfill statements of the migration, as written in the file. */
  async function runBackfill() {
    const file = await readFile("drizzle/0011_goal_snapshots.sql", "utf8");
    const statements = file
      .slice(file.indexOf("-- Backfill"))
      .split("--> statement-breakpoint")
      .map((st) =>
        st
          .split("\n")
          .filter((line) => !line.startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) await db.execute(sql.raw(statement));
  }

  it("marks the roles on a cycle launched before roles existed", async () => {
    const cycle = await collectingCycle();
    const revisions = () =>
      db
        .select()
        .from(questionRevision)
        .where(eq(questionRevision.cycleId, cycle.id));
    const before = await revisions();
    const rolesByPrompt = Object.fromEntries(
      before.filter((r) => r.role).map((r) => [r.id, r.role]),
    );
    expect(Object.keys(rolesByPrompt)).toHaveLength(3);

    // As it was before the roles: none on questions nor on revisions, and the
    // goals rating's template question is gone (its revision is orphaned).
    // (Only the roles that backfill restores: retention/engagement of the
    // Santex template are not part of it.)
    await db
      .update(question)
      .set({ role: null })
      .where(
        inArray(question.role, [
          "goals_rating",
          "goals_comment",
          "overall_rating",
        ]),
      );
    await db.update(questionRevision).set({ role: null });
    const goalsRating = before.find((r) => r.role === "goals_rating")!;
    await db
      .update(questionRevision)
      .set({ questionId: null })
      .where(eq(questionRevision.id, goalsRating.id));

    await runBackfill();

    const after = await revisions();
    expect(
      Object.fromEntries(
        after.filter((r) => r.role).map((r) => [r.id, r.role]),
      ),
    ).toEqual(rolesByPrompt);
    // Templates are marked again too, so a new cycle gets them.
    const next = await collectingCycle({ name: "H1 again" });
    expect(
      (
        await db
          .select()
          .from(questionRevision)
          .where(eq(questionRevision.cycleId, next.id))
      ).filter((r) => r.role),
    ).toHaveLength(3);
  });
});
