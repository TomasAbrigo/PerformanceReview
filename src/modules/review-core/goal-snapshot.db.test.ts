import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
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
  reviewCycle,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import {
  cloneTemplate,
  listTemplates,
  seedSystemTemplates,
} from "@/modules/templates";
import {
  addParticipant,
  createCycle,
  findManagerRequestId,
  getReview,
  launchCycle,
  ReviewError,
  saveDraft,
  submit,
  transition,
  type CycleInput,
  type Review,
} from ".";
import {
  getReviewGoals,
  isGoalsQuestion,
  linkGoalToCycle,
  overallRatingQuestion,
  refreshGoalProgress,
  snapshotGoalsForParticipant,
} from "./goal-snapshot";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

// As of 2022-06-01: Bruno reports to Carla, Carla to Ana, Ana to nobody.
let ana: string;
let bruno: string;
let carla: string;
let templateId: string;

const hr: ActorContext = { personId: null, role: "hr" };
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

function input(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    name: "H1 2022",
    periodStart: "2022-01-01",
    periodEnd: "2022-06-30",
    snapshotDate: "2022-06-01",
    components: {
      self: true,
      manager: true,
      peer: false,
      upward: false,
      calibration: false,
    },
    anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
    templateId,
    dueDates: {},
    participantFilter: { kind: "people", personIds: [ana, bruno] },
    ...overrides,
  };
}

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

/** Without peers the cycle launches straight into collecting. */
async function collectingCycle(overrides: Partial<CycleInput> = {}) {
  const cycle = await createCycle(db, input(overrides));
  await launchCycle(db, cycle.id, null);
  return cycle;
}

describe("snapshot at launch", () => {
  it("holds exactly the goals that overlap the period, as they were", async () => {
    await seedGoals();
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);

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
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
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
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    expect(await snapshotOf((await participantOf(cycle.id, bruno)).id)).toEqual(
      [],
    );
  });

  it("never adds a goal created after the launch", async () => {
    await seedGoals();
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    const bruno1 = await participantOf(cycle.id, bruno);
    await addGoal({ personId: bruno, title: "Late", dueDate: "2022-05-01" });

    expect(titles(await snapshotOf(bruno1.id))).not.toContain("Late");
    await refreshGoalProgress(db, hr, bruno1.id);
    expect(titles(await snapshotOf(bruno1.id))).toEqual([
      "A due inside",
      "C runs past the period",
    ]);
  });

  it("snapshots a participant added later at that moment", async () => {
    await seedGoals();
    const cycle = await collectingCycle({
      participantFilter: { kind: "people", personIds: [ana] },
    });
    await addGoal({
      personId: bruno,
      title: "Created after launch",
      dueDate: "2022-05-01",
    });

    const added = await addParticipant(db, cycle.id, bruno, "2022-06-01");
    const rows = await snapshotOf(added.id);
    expect(titles(rows)).toEqual([
      "A due inside",
      "C runs past the period",
      "Created after launch",
    ]);
    // Ana's own snapshot (taken at launch) is untouched.
    expect(
      titles(await snapshotOf((await participantOf(cycle.id, ana)).id)),
    ).toEqual(["F of Ana"]);
  });

  it("retakes the snapshot when a removed participant is added again", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const first = await participantOf(cycle.id, bruno);
    await db
      .update(cycleParticipant)
      .set({ removedAt: new Date() })
      .where(eq(cycleParticipant.id, first.id));
    await db.delete(goal).where(eq(goal.title, "A due inside"));
    await addParticipant(db, cycle.id, bruno, "2022-06-01");
    expect(titles(await snapshotOf(first.id))).toEqual([
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
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
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
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    expect(
      titles(await snapshotOf((await participantOf(cycle.id, bruno)).id)),
    ).toEqual(["Native, last evening"]);
  });

  it("snapshotGoalsForParticipant takes the capture date it is given", async () => {
    await seedGoals();
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
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

describe("refreshGoalProgress", () => {
  it("updates status and progress and the refresh date, not the list", async () => {
    const { dueInside } = await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await db
      .update(goal)
      .set({
        percentComplete: 90,
        status: "completed",
        title: "Renamed later",
        dueDate: "2022-04-04",
      })
      .where(eq(goal.id, dueInside.id));
    await addGoal({ personId: bruno, title: "Late", dueDate: "2022-05-01" });

    const before = await snapshotOf(p.id);
    await refreshGoalProgress(db, hr, p.id);
    const after = await snapshotOf(p.id);

    expect(after).toHaveLength(before.length);
    expect(titles(after)).toEqual(titles(before)); // frozen titles
    expect(after[0]).toMatchObject({
      percentComplete: 90,
      status: "completed",
      dueDate: "2022-03-01", // frozen
      noLongerApplicable: false,
    });
    expect(after[0].capturedAt).toEqual(before[0].capturedAt);
    expect(after[0].refreshedAt).toBeInstanceOf(Date);
    expect(after[1].percentComplete).toBe(25);
  });

  it("flags deleted goals as no longer applicable and keeps their figures", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await db
      .update(goal)
      .set({ deletedAt: new Date() })
      .where(eq(goal.title, "A due inside"));
    await db.delete(goal).where(eq(goal.title, "C runs past the period"));

    await refreshGoalProgress(db, hr, p.id);
    const rows = await snapshotOf(p.id);
    expect(rows.map((r) => r.noLongerApplicable)).toEqual([true, true]);
    expect(rows[0]).toMatchObject({
      percentComplete: 40,
      title: "A due inside",
    });
    expect(rows[1].goalId).toBeNull(); // hard delete: set null, copy kept
  });

  it("is allowed to HR and to the snapshot manager only", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await refreshGoalProgress(db, as(carla, "manager"), p.id);
    const denied = [
      as(bruno, "employee"),
      as(bruno, "manager"),
      as(ana, "manager"), // manages Carla, not Bruno
      as(carla, "employee"),
    ];
    for (const actor of denied) {
      await expect(refreshGoalProgress(db, actor, p.id)).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    await expect(
      refreshGoalProgress(db, hr, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(ReviewError);
  });

  it("does not find the participant of a deleted cycle", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await db
      .update(reviewCycle)
      .set({ deletedAt: new Date() })
      .where(eq(reviewCycle.id, cycle.id));
    await expect(refreshGoalProgress(db, hr, p.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("is not allowed once the cycle is closed", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await transition(db, cycle.id, "manager_review", null);
    await transition(db, cycle.id, "sharing", null);
    await transition(db, cycle.id, "closed", null);
    await expect(refreshGoalProgress(db, hr, p.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("explicit goal link", () => {
  it("attaches a goal outside the period to the owner's snapshot", async () => {
    await seedGoals();
    const outside = await addGoal({
      personId: bruno,
      title: "Outside",
      dueDate: "2023-01-01",
      status: "completed",
      completionDate: "2023-01-01",
      percentComplete: 100,
    });
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);

    await linkGoalToCycle(db, hr, cycle.id, outside.id);
    await linkGoalToCycle(db, hr, cycle.id, outside.id); // idempotent

    expect(titles(await snapshotOf(p.id))).toContain("Outside");
    expect(
      await db
        .select()
        .from(cycleGoalLink)
        .where(eq(cycleGoalLink.cycleId, cycle.id)),
    ).toHaveLength(1);
  });

  it("refreshes the whole snapshot, so the legend moves to the link date", async () => {
    await seedGoals();
    const outside = await addGoal({
      personId: bruno,
      title: "Outside",
      dueDate: "2023-01-01",
    });
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await db
      .update(participantGoalSnapshot)
      .set({ capturedAt: new Date("2022-01-10T12:00:00Z") })
      .where(eq(participantGoalSnapshot.participantId, p.id));
    await db
      .update(goal)
      .set({ percentComplete: 77 })
      .where(eq(goal.title, "A due inside"));

    await linkGoalToCycle(
      db,
      hr,
      cycle.id,
      outside.id,
      new Date("2022-03-05T12:00:00Z"),
    );

    const rows = await snapshotOf(p.id);
    expect(titles(rows)).toContain("Outside");
    // Every goal is as of the same moment, with its current figures.
    expect(
      new Set(rows.map((r) => (r.refreshedAt ?? r.capturedAt).toISOString())),
    ).toEqual(new Set(["2022-03-05T12:00:00.000Z"]));
    expect(rows.find((r) => r.title === "A due inside")?.percentComplete).toBe(
      77,
    );
    const requestId = (await findManagerRequestId(db, hr, p.id))!;
    expect((await getReviewGoals(db, hr, requestId))!.asOf).toBe("2022-03-05");
  });

  it("feeds the snapshot of a participant added afterwards", async () => {
    const outside = await addGoal({
      personId: carla,
      title: "Linked of Carla",
      dueDate: "2023-01-01",
    });
    const cycle = await collectingCycle();
    await linkGoalToCycle(db, hr, cycle.id, outside.id); // Carla not in yet
    const added = await addParticipant(db, cycle.id, carla, "2022-06-01");
    expect(titles(await snapshotOf(added.id))).toEqual(["Linked of Carla"]);
  });

  it("is HR only and needs a live goal", async () => {
    const g = await addGoal({
      personId: bruno,
      title: "X",
      dueDate: "2023-01-01",
    });
    const cycle = await collectingCycle();
    await expect(
      linkGoalToCycle(db, as(carla, "manager"), cycle.id, g.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      linkGoalToCycle(db, hr, cycle.id, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("getReviewGoals", () => {
  it("returns the block for the manager form, with the legend date", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const requestId = (await findManagerRequestId(db, as(carla), p.id))!;

    const block = (await getReviewGoals(db, as(carla, "manager"), requestId))!;
    expect(titles(block.goals)).toEqual([
      "A due inside",
      "C runs past the period",
    ]);
    expect(block.participantId).toBe(p.id);
    expect(block.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(block.canRefresh).toBe(true);
    expect(block.canLink).toBe(false);

    const asHr = (await getReviewGoals(db, hr, requestId))!;
    expect(asHr.canLink).toBe(true);
    expect(asHr.linkable).toHaveLength(2); // B and D: outside the period
  });

  it("takes the review that is already loaded instead of loading it again", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const actor = as(carla, "manager");
    const requestId = (await findManagerRequestId(db, actor, p.id))!;
    const review = (await getReview(db, actor, requestId))!;
    expect(await getReviewGoals(db, actor, review)).toEqual(
      await getReviewGoals(db, actor, requestId),
    );
  });

  it("offers the owner's goals that are not in the snapshot to HR", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const requestId = (await findManagerRequestId(db, hr, p.id))!;
    const block = (await getReviewGoals(db, hr, requestId))!;
    expect(block.linkable.map((g) => g.title).sort()).toEqual([
      "B due before",
      "D closed, no date",
    ]);
  });

  it("moves the legend date when the progress is refreshed", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await db
      .update(participantGoalSnapshot)
      .set({ capturedAt: new Date("2022-01-10T12:00:00Z") })
      .where(eq(participantGoalSnapshot.participantId, p.id));
    const requestId = (await findManagerRequestId(db, hr, p.id))!;
    expect((await getReviewGoals(db, hr, requestId))!.asOf).toBe("2022-01-10");
    await refreshGoalProgress(db, hr, p.id, new Date("2022-03-05T12:00:00Z"));
    expect((await getReviewGoals(db, hr, requestId))!.asOf).toBe("2022-03-05");
  });

  it("is null for someone who cannot read the review", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const requestId = (await findManagerRequestId(db, hr, p.id))!;
    expect(await getReviewGoals(db, as(bruno), requestId)).toBeNull();
  });

  it("has no legend date and nothing to refresh without goals", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const requestId = (await findManagerRequestId(db, hr, p.id))!;
    const block = (await getReviewGoals(db, hr, requestId))!;
    expect(block.goals).toEqual([]);
    expect(block.asOf).toBeNull();
    expect(block.canRefresh).toBe(false);
  });
});

describe("goals rating", () => {
  const revisionsOf = (cycleId: string) =>
    db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.cycleId, cycleId));

  it("marks the goals rating and its comment apart from the overall rating", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
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
    const cycle = await createCycle(db, input({ templateId: copy.id }));
    await launchCycle(db, cycle.id, null);
    expect(
      (await revisionsOf(cycle.id)).filter((r) => r.role === "goals_rating"),
    ).toHaveLength(1);
  });

  /** Fills every question of a review but the goals ones. */
  const fillExceptGoals = (review: Review) =>
    review.questions
      .filter((q) => !isGoalsQuestion(q))
      .map((q) => ({
        questionRevisionId: q.id,
        value:
          q.kind === "rating"
            ? q.scale!.options[0].value
            : `Respuesta ${q.sort}`,
      }));

  async function managerRequest(
    cycleId: string,
    reviewee: string,
    manager: string,
  ) {
    const p = await participantOf(cycleId, reviewee);
    return (await findManagerRequestId(db, as(manager, "manager"), p.id))!;
  }

  it("is optional, with its comment, when the participant has no goals", async () => {
    const cycle = await collectingCycle(); // nobody has goals
    const requestId = await managerRequest(cycle.id, bruno, carla);
    const actor = as(carla, "manager");
    const review = (await getReview(db, actor, requestId))!;
    const goalsQuestions = review.questions.filter(isGoalsQuestion);
    expect(goalsQuestions).toHaveLength(2);
    expect(goalsQuestions.every((q) => !q.required)).toBe(true);
    expect(
      review.questions
        .filter((q) => !isGoalsQuestion(q))
        .every((q) => q.required),
    ).toBe(true);

    await saveDraft(db, actor, requestId, fillExceptGoals(review));
    const submitted = await submit(db, actor, requestId);
    expect(submitted.status).toBe("submitted");
  });

  it("is optional when every snapshot goal no longer applies", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    await db
      .update(goal)
      .set({ deletedAt: new Date() })
      .where(eq(goal.personId, bruno));
    const p = await participantOf(cycle.id, bruno);
    await refreshGoalProgress(db, hr, p.id);
    const requestId = await managerRequest(cycle.id, bruno, carla);
    const actor = as(carla, "manager");
    const review = (await getReview(db, actor, requestId))!;
    await saveDraft(db, actor, requestId, fillExceptGoals(review));
    await expect(submit(db, actor, requestId)).resolves.toBeTruthy();
  });

  it("is required when the participant has goals", async () => {
    await seedGoals();
    const cycle = await collectingCycle();
    const requestId = await managerRequest(cycle.id, bruno, carla);
    const actor = as(carla, "manager");
    const review = (await getReview(db, actor, requestId))!;
    expect(
      review.questions.filter(isGoalsQuestion).every((q) => q.required),
    ).toBe(true);

    await saveDraft(db, actor, requestId, fillExceptGoals(review));
    const error = await submit(db, actor, requestId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReviewError);
    const issues = (error as ReviewError).issues.map((i) => i.path);
    const goalsIds = review.questions.filter(isGoalsQuestion).map((q) => q.id);
    expect(issues.sort()).toEqual(goalsIds.sort());
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
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
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
    await db.update(question).set({ role: null });
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
    const next = await createCycle(db, input({ name: "H1 again" }));
    await launchCycle(db, next.id, null);
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
