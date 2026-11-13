import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  goal,
  goalComment,
  goalMilestone,
  goalShare,
  ingestRun,
  person,
  rawRecord,
} from "@/db/schema";
import {
  FixtureAdapter,
  runIngest,
  type SourceAdapter,
} from "@/modules/ingest";
import { runGoalIngest } from "./ingest";
import {
  editJson,
  goalOf,
  resetGoalTables,
  type AggregateJson,
  type CommentsJson,
} from "./test-support";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let dir: string;

const reset = resetGoalTables;
const editGoals = (file: string, edit: (json: AggregateJson) => void) =>
  editJson(dir, file, edit);
const editComments = (file: string, edit: (json: CommentsJson) => void) =>
  editJson(dir, file, edit);

/** Wraps an adapter to record the goals whose comments were requested. */
function tracked(inner: SourceAdapter) {
  const loaded: string[] = [];
  const adapter: SourceAdapter = {
    source: inner.source,
    name: inner.name,
    entities: inner.entities,
    async *extract(ctx, entity) {
      for await (const r of inner.extract(ctx, entity)) {
        const load = r.loadComments;
        yield load
          ? {
              ...r,
              loadComments: async () => {
                loaded.push(r.sourceId);
                return load();
              },
            }
          : r;
      }
    },
  };
  return { adapter, loaded };
}

/** The same records in the opposite order (employee 102's aggregate first). */
function reversed(inner: SourceAdapter): SourceAdapter {
  return {
    source: inner.source,
    name: inner.name,
    entities: inner.entities,
    async *extract(ctx, entity) {
      const all = [];
      for await (const r of inner.extract(ctx, entity)) all.push(r);
      yield* all.reverse();
    },
  };
}

/** An adapter that could not read one employee's goals (Bamboo answered `status`). */
function skipping(
  inner: SourceAdapter,
  employeeId: string,
  status: number,
): SourceAdapter {
  return {
    source: inner.source,
    name: inner.name,
    entities: inner.entities,
    extract(ctx, entity) {
      ctx.onSkip?.({ employeeId, status });
      return inner.extract(
        {
          ...ctx,
          employeeIds: ctx.employeeIds?.filter((id) => id !== employeeId),
        },
        entity,
      );
    },
  };
}

const runRejects = async (runId: string) => {
  const [run] = await db
    .select()
    .from(ingestRun)
    .where(eq(ingestRun.id, runId));
  return run.rejects;
};

const ingestEmployees = () =>
  runIngest({ adapter: new FixtureAdapter(dir), entity: "employee", db });
const ingestGoals = (adapter: SourceAdapter = new FixtureAdapter(dir)) =>
  runGoalIngest({ adapter, db });

const goalBySource = async (sourceId: string) => {
  const [row] = await db.select().from(goal).where(eq(goal.sourceId, sourceId));
  return row;
};
const personByName = async (displayName: string) => {
  const [row] = await db
    .select()
    .from(person)
    .where(eq(person.displayName, displayName));
  return row;
};

describe("runGoalIngest (goals from fixtures)", () => {
  beforeEach(async () => {
    await reset();
    dir = await mkdtemp(path.join(tmpdir(), "goals-ingest-"));
    await cp(FIXTURES, dir, { recursive: true });
    await ingestEmployees();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("creates goals with their source ids for active employees only", async () => {
    const { counts, runId } = await ingestGoals();

    // Ana (101) and Bruno (102) are active; Carla (103, terminated) is not read.
    // Goal 9001 is shared with Bruno and listed in both aggregates: stored once.
    expect(counts).toEqual({
      read: 5,
      inserted: 5,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      deleted: 0,
    });
    const goals = await db.select().from(goal).orderBy(goal.sourceId);
    expect(goals.map((g) => g.sourceId)).toEqual([
      "9001",
      "9002",
      "9101",
      "9102",
      "9103",
    ]);
    const ana = await personByName("Ana García");
    const bruno = await personByName("Bruno Pérez");
    expect(goals.map((g) => g.personId)).toEqual([
      ana.id,
      ana.id,
      bruno.id,
      bruno.id,
      bruno.id,
    ]);

    const plan = await goalBySource("9001");
    expect(plan).toMatchObject({
      title: "Definir el plan de carrera del área",
      description:
        "Roles, niveles y criterios de promoción para el área de People.",
      percentComplete: 50,
      status: "in_progress",
      dueDate: "2026-12-15",
      completionDate: null,
      alignsWithSourceId: "12",
      commentCount: 2,
      sourceSystem: "bamboo_api",
      ingestRunId: runId,
    });
    expect(plan.lastChangedAt).toEqual(new Date("2026-11-02T14:20:00Z"));
    expect(plan.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run).toMatchObject({
      status: "succeeded",
      sourceSystem: "bamboo_api",
      params: expect.objectContaining({ entity: "goal" }),
      counts,
    });
  });

  it("keeps the numeric ids from the payload as strings", async () => {
    await ingestGoals();

    // 9001 / 9101 / 9102 are numbers in the fixtures, 9002 / 9103 strings.
    const raws = await db
      .select()
      .from(rawRecord)
      .where(eq(rawRecord.entity, "goal"));
    expect(raws.map((r) => r.sourceId).sort()).toEqual([
      "9001",
      "9002",
      "9101",
      "9102",
      "9103",
    ]);
    const plan = raws.find((r) => r.sourceId === "9001")!.payload as {
      employeeId: string;
      goal: { id: unknown; sharedWithEmployeeIds: unknown };
    };
    expect(plan.employeeId).toBe("101");
    expect(plan.goal.id).toBe("9001");
    expect(plan.goal.sharedWithEmployeeIds).toEqual(["102"]);

    const milestones = await db.select().from(goalMilestone);
    expect(milestones.every((m) => typeof m.sourceId === "string")).toBe(true);
    expect(milestones.map((m) => m.sourceId).sort()).toContain("5001");
  });

  it("creates milestones in order, with completion", async () => {
    await ingestGoals();

    const plan = await goalBySource("9001");
    const milestones = await db
      .select()
      .from(goalMilestone)
      .where(eq(goalMilestone.goalId, plan.id))
      .orderBy(goalMilestone.position);
    expect(milestones.map((m) => [m.sourceId, m.title, m.position])).toEqual([
      ["5001", "Mapear roles actuales", 0],
      ["5002", "Publicar el framework", 1],
    ]);
    expect(milestones[0].completedAt).toEqual(new Date("2026-10-01T12:00:00Z"));
    expect(milestones[0].lastUpdateAt).toEqual(
      new Date("2026-10-01T12:00:00Z"),
    );
    expect(milestones[1].completedAt).toBeNull();
    expect(milestones[0]).toMatchObject({ sourceSystem: "bamboo_api" });
  });

  it("stores goals without milestones (null or []) with no milestone rows", async () => {
    await ingestGoals();

    for (const id of ["9002", "9102", "9103"]) {
      const g = await goalBySource(id);
      expect(g).toBeDefined();
      const rows = await db
        .select()
        .from(goalMilestone)
        .where(eq(goalMilestone.goalId, g.id));
      expect(rows).toEqual([]);
    }
  });

  it("creates comments with authors resolved to people and the source user id", async () => {
    await ingestGoals();

    const plan = await goalBySource("9001");
    const comments = await db
      .select()
      .from(goalComment)
      .where(eq(goalComment.goalId, plan.id))
      .orderBy(goalComment.postedAt);
    const ana = await personByName("Ana García");
    const bruno = await personByName("Bruno Pérez");
    expect(
      comments.map((c) => [c.sourceId, c.authorSourceUserId, c.authorPersonId]),
    ).toEqual([
      ["7001", "8101", ana.id],
      ["7002", "8102", bruno.id],
    ]);
    expect(comments[0].text).toBe(
      "Avance del mapeo listo, falta validarlo con People.",
    );
    expect(comments[0].postedAt).toEqual(new Date("2026-10-05T10:00:00Z"));
    expect(comments[0]).toMatchObject({ sourceSystem: "bamboo_api" });

    const raws = await db
      .select()
      .from(rawRecord)
      .where(eq(rawRecord.entity, "goal_comment"));
    expect(raws.map((r) => r.sourceId).sort()).toEqual(["9001", "9101"]);
  });

  it("creates shares from sharedWithEmployeeIds through source identities", async () => {
    await ingestGoals();

    const plan = await goalBySource("9001");
    const bruno = await personByName("Bruno Pérez");
    const shares = await db
      .select()
      .from(goalShare)
      .where(eq(goalShare.goalId, plan.id));
    expect(shares.map((s) => s.personId)).toEqual([bruno.id]);
    expect(await db.select().from(goalShare)).toHaveLength(1);
  });

  it("stores a closed goal as closed", async () => {
    await ingestGoals();

    expect(await goalBySource("9002")).toMatchObject({
      status: "closed",
      percentComplete: 60,
      deletedAt: null,
    });
  });

  it("never deletes a goal that disappears from the source; closed stays closed", async () => {
    await ingestGoals();
    await editGoals("goals/101.json", (json) => {
      json.goals = json.goals.filter((g: { id: unknown }) => g.id !== "9002");
    });
    await editGoals("goals/102.json", (json) => {
      json.goals = [];
    });

    const { counts } = await ingestGoals();

    expect(counts).toMatchObject({ read: 1, deleted: 0 });
    expect(await db.select().from(goal)).toHaveLength(5);
    expect(await goalBySource("9002")).toMatchObject({
      status: "closed",
      deletedAt: null,
    });
  });

  it("is idempotent: a re-run changes nothing and reads no comments", async () => {
    await ingestGoals();
    const before = {
      goals: await db.select().from(goal).orderBy(goal.sourceId),
      milestones: await db.select().from(goalMilestone),
      comments: await db.select().from(goalComment),
      shares: await db.select().from(goalShare),
      raw: await db.select().from(rawRecord),
    };
    const { adapter, loaded } = tracked(new FixtureAdapter(dir));

    const { counts, runId } = await ingestGoals(adapter);

    expect(counts).toEqual({
      read: 5,
      inserted: 0,
      updated: 0,
      unchanged: 5,
      rejected: 0,
      deleted: 0,
    });
    expect(loaded).toEqual([]);
    expect(await db.select().from(goal).orderBy(goal.sourceId)).toEqual(
      before.goals,
    );
    expect(await db.select().from(goalMilestone)).toHaveLength(
      before.milestones.length,
    );
    expect(await db.select().from(goalComment)).toHaveLength(
      before.comments.length,
    );
    expect(await db.select().from(goalShare)).toHaveLength(
      before.shares.length,
    );
    expect(await db.select().from(rawRecord)).toHaveLength(before.raw.length);
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.counts).toEqual(counts);
  });

  it("fetches comments on the first run only for goals that report some", async () => {
    const { adapter, loaded } = tracked(new FixtureAdapter(dir));

    await ingestGoals(adapter);

    expect(loaded.sort()).toEqual(["9001", "9101"]);
  });

  it("fetches comments again only for the goal whose comment count changed", async () => {
    await ingestGoals();
    await editGoals("goals/101.json", (json) => {
      json.comments = [{ goalId: "9001", commentCount: 3 }];
    });
    await editComments("goal-comments/9001.json", (json) => {
      json.comments.push({
        id: "7003",
        authorUserId: 8101,
        createdAt: "2026-11-10T09:00:00Z",
        text: "Listo el borrador del framework.",
      });
    });
    const { adapter, loaded } = tracked(new FixtureAdapter(dir));

    const { counts } = await ingestGoals(adapter);

    expect(loaded).toEqual(["9001"]);
    expect(counts).toMatchObject({ updated: 1, unchanged: 4, inserted: 0 });
    const plan = await goalBySource("9001");
    expect(plan.commentCount).toBe(3);
    const comments = await db
      .select()
      .from(goalComment)
      .where(eq(goalComment.goalId, plan.id));
    expect(comments.map((c) => c.sourceId).sort()).toEqual([
      "7001",
      "7002",
      "7003",
    ]);
  });

  it("does not fetch comments when only other fields changed", async () => {
    await ingestGoals();
    await editGoals("goals/102.json", (json) => {
      const g = goalOf(json, 9101);
      g.percentComplete = 80;
      g.lastChangedDateTime = "2026-11-12T10:00:00Z";
    });
    const { adapter, loaded } = tracked(new FixtureAdapter(dir));

    const { counts } = await ingestGoals(adapter);

    expect(loaded).toEqual([]);
    expect(counts).toMatchObject({ updated: 1, unchanged: 4 });
    expect(await goalBySource("9101")).toMatchObject({
      percentComplete: 80,
      commentCount: 1,
    });
    expect(await db.select().from(goalComment)).toHaveLength(3);
  });

  it("soft-deletes comments Bamboo no longer lists", async () => {
    await ingestGoals();
    await editGoals("goals/101.json", (json) => {
      json.comments = [{ goalId: "9001", commentCount: 1 }];
    });
    await editComments("goal-comments/9001.json", (json) => {
      json.comments = json.comments.slice(0, 1);
    });

    await ingestGoals();

    const plan = await goalBySource("9001");
    const comments = await db
      .select()
      .from(goalComment)
      .where(eq(goalComment.goalId, plan.id));
    expect(
      comments.map((c) => [c.sourceId, c.deletedAt === null]).sort(),
    ).toEqual([
      ["7001", true],
      ["7002", false],
    ]);
  });

  it("updates a changed goal and syncs its milestones and shares", async () => {
    await ingestGoals();
    await editGoals("goals/101.json", (json) => {
      const g = json.goals[0];
      g.percentComplete = 100;
      g.status = "completed";
      g.completionDate = "2026-11-10";
      g.lastChangedDateTime = "2026-11-10T08:00:00Z";
      g.sharedWithEmployeeIds = [];
      g.milestones![1].completedDateTime = "2026-11-10T08:00:00Z";
      g.milestones!.shift(); // 5001 removed
      g.milestones!.push({
        id: 5003,
        employeeGoalId: 9001,
        title: "Comunicar al área",
        completedDateTime: null,
        lastUpdateDateTime: "2026-11-10T08:00:00Z",
      });
    });
    // The shared copy in Bruno's aggregate is edited the same way.
    await editGoals("goals/102.json", (json) => {
      json.goals = json.goals.filter((g: { id: unknown }) => g.id !== 9001);
    });

    const { counts } = await ingestGoals();

    expect(counts).toMatchObject({ updated: 1, unchanged: 4, inserted: 0 });
    const plan = await goalBySource("9001");
    expect(plan).toMatchObject({
      percentComplete: 100,
      status: "completed",
      completionDate: "2026-11-10",
    });
    const milestones = await db
      .select()
      .from(goalMilestone)
      .where(eq(goalMilestone.goalId, plan.id));
    expect(
      milestones
        .map((m) => [m.sourceId, m.deletedAt === null, m.completedAt !== null])
        .sort(),
    ).toEqual([
      ["5001", false, true],
      ["5002", true, true],
      ["5003", true, false],
    ]);
    expect(
      await db.select().from(goalShare).where(eq(goalShare.goalId, plan.id)),
    ).toEqual([]);
  });

  it("does not let a person a goal is shared with become its owner", async () => {
    await ingestGoals();

    // Bruno's aggregate also lists 9001, but he only has it shared.
    const plan = await goalBySource("9001");
    const ana = await personByName("Ana García");
    expect(plan.personId).toBe(ana.id);
  });

  it("reports a shared goal whose owner was not read instead of storing it", async () => {
    await editGoals("goals/101.json", (json) => {
      json.goals = [];
      json.comments = [];
    });

    const { counts, runId } = await ingestGoals();

    // The unstored shared goal counts as read and rejected, like any reject.
    expect(counts).toMatchObject({ read: 4, inserted: 3, rejected: 1 });
    expect(await goalBySource("9001")).toBeUndefined();
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.rejects).toEqual([
      { sourceId: "9001", reason: expect.stringContaining("owner") },
    ]);
  });

  it("rejects a goal with an unknown status and keeps going", async () => {
    await editGoals("goals/102.json", (json) => {
      goalOf(json, 9102).status = "weird";
    });

    const { counts, runId } = await ingestGoals();

    expect(counts).toMatchObject({ read: 5, inserted: 4, rejected: 1 });
    expect(await goalBySource("9102")).toBeUndefined();
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.rejects).toEqual([
      { sourceId: "9102", reason: expect.any(String) },
    ]);
  });

  it("flags a share with an unknown employee and retries it on the next run", async () => {
    await editGoals("goals/101.json", (json) => {
      json.goals[0].sharedWithEmployeeIds = [102, 999];
    });

    const first = await ingestGoals();

    const plan = await goalBySource("9001");
    expect(
      await db.select().from(goalShare).where(eq(goalShare.goalId, plan.id)),
    ).toHaveLength(1);
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, first.runId));
    expect(run.rejects).toEqual([
      { sourceId: "9001", reason: expect.stringContaining("999") },
    ]);

    // Unchanged payload, but the goal was incomplete: it is revisited.
    const second = await ingestGoals();
    expect(second.counts).toMatchObject({ updated: 1, unchanged: 4 });
  });

  it("marks a failed run and keeps the goals stored so far", async () => {
    const failing: SourceAdapter = {
      source: "bamboo_api",
      name: "failing",
      entities: ["goal"],
      async *extract(ctx, entity) {
        yield* new FixtureAdapter(dir).extract(ctx, entity);
        throw new Error("boom");
      },
    };

    await expect(ingestGoals(failing)).rejects.toThrow("boom");

    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(sql`${ingestRun.params}->>'entity'`, "goal"));
    expect(run).toMatchObject({ status: "failed", error: "boom" });
    expect(await db.select().from(goal)).toHaveLength(5);
  });

  it("retries a comment that failed staging on the next run", async () => {
    const flaky = (broken: boolean): SourceAdapter => {
      const inner = new FixtureAdapter(dir);
      return {
        source: inner.source,
        name: inner.name,
        entities: inner.entities,
        async *extract(ctx, entity) {
          for await (const r of inner.extract(ctx, entity)) {
            const load = r.loadComments;
            yield broken && load && r.sourceId === "9001"
              ? {
                  ...r,
                  // The second comment has no id: it cannot be staged.
                  loadComments: async () => [
                    ...(await load()).slice(0, 1),
                    { text: "sin id", authorUserId: 8102 },
                  ],
                }
              : r;
          }
        },
      };
    };

    const first = await ingestGoals(flaky(true));

    const plan = await goalBySource("9001");
    expect(
      await db
        .select()
        .from(goalComment)
        .where(eq(goalComment.goalId, plan.id)),
    ).toHaveLength(1);
    // Bamboo says 2 comments; only 1 was stored, so the count must not claim 2.
    expect(plan.commentCount).toBe(1);
    expect(await runRejects(first.runId)).toEqual([
      { sourceId: "9001", reason: expect.stringContaining("goal_comment") },
    ]);

    const { adapter, loaded } = tracked(flaky(false));
    await ingestGoals(adapter);

    expect(loaded).toEqual(["9001"]);
    expect(
      await db
        .select()
        .from(goalComment)
        .where(eq(goalComment.goalId, plan.id)),
    ).toHaveLength(2);
    expect((await goalBySource("9001")).commentCount).toBe(2);
  });

  describe("goal owner when the goal is listed in several aggregates", () => {
    it.each([
      ["in extraction order", (a: SourceAdapter) => a],
      ["in reverse extraction order", reversed],
    ])(
      "the copy that lists the most people it is shared with owns it, even if the sharee's copy omits itself (%s)",
      async (_name, order) => {
        // Bruno's copy lists nobody (not even himself): both copies look like owner copies.
        await editGoals("goals/102.json", (json) => {
          goalOf(json, 9001).sharedWithEmployeeIds = [];
        });

        const { counts } = await ingestGoals(order(new FixtureAdapter(dir)));

        const ana = await personByName("Ana García");
        expect((await goalBySource("9001")).personId).toBe(ana.id);
        expect(counts).toMatchObject({ read: 5, inserted: 5, rejected: 0 });
      },
    );

    it.each([
      ["in extraction order", (a: SourceAdapter) => a],
      ["in reverse extraction order", reversed],
    ])(
      "an undecidable owner is chosen by employee id, not by arrival, and reported (%s)",
      async (_name, order) => {
        // Nobody is listed as sharee in either copy: nothing tells them apart.
        await editGoals("goals/101.json", (json) => {
          goalOf(json, 9001).sharedWithEmployeeIds = [];
        });
        await editGoals("goals/102.json", (json) => {
          goalOf(json, 9001).sharedWithEmployeeIds = [];
        });

        const { runId } = await ingestGoals(order(new FixtureAdapter(dir)));

        const ana = await personByName("Ana García");
        expect((await goalBySource("9001")).personId).toBe(ana.id);
        expect(await runRejects(runId)).toEqual([
          {
            sourceId: "9001",
            reason: expect.stringMatching(/owner.*101.*102/),
          },
        ]);
      },
    );
  });

  it("skips an employee whose goals Bamboo refuses to give and keeps going", async () => {
    const { counts, runId } = await ingestGoals(
      skipping(new FixtureAdapter(dir), "101", 404),
    );

    // Ana's goals are missing; Bruno's own are stored, and the plan he only
    // has shared stays out because its owner was not read.
    expect(counts).toEqual({
      read: 5,
      inserted: 3,
      updated: 0,
      unchanged: 0,
      rejected: 2,
      deleted: 0,
    });
    expect(await runRejects(runId)).toEqual([
      { sourceId: "101", reason: expect.stringContaining("404") },
      { sourceId: "9001", reason: expect.stringContaining("owner") },
    ]);
    expect(await db.select().from(goal)).toHaveLength(3);
  });

  it("fails the run when Bamboo refuses every employee (a systematic problem, not a bad record)", async () => {
    const refusing: SourceAdapter = {
      ...new FixtureAdapter(dir),
      source: "bamboo_api",
      name: "refusing",
      entities: ["goal"],
      async *extract(ctx) {
        for (const employeeId of ctx.employeeIds ?? []) {
          ctx.onSkip?.({ employeeId, status: 403 });
        }
      },
    };

    await expect(ingestGoals(refusing)).rejects.toThrow(/no employee/i);

    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(sql`${ingestRun.params}->>'entity'`, "goal"));
    expect(run).toMatchObject({ status: "failed" });
    expect(run.rejects).toHaveLength(2);
  });

  it("rejects a goal with a milestone without a title and keeps going", async () => {
    // The goal is listed in Ana's and in Bruno's aggregate: both copies are broken.
    for (const file of ["goals/101.json", "goals/102.json"]) {
      await editGoals(file, (json) => {
        const [milestone] = goalOf(json, 9001).milestones!;
        milestone.title = "  ";
      });
    }

    const { counts, runId } = await ingestGoals();

    expect(counts).toMatchObject({ read: 5, inserted: 4, rejected: 1 });
    expect(await goalBySource("9001")).toBeUndefined();
    expect(await runRejects(runId)).toEqual([
      { sourceId: "9001", reason: expect.stringContaining("milestone") },
    ]);
  });
});
