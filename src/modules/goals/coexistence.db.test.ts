import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  goal,
  goalMilestone,
  participantGoalSnapshot,
  person,
  reviewCycle,
} from "@/db/schema";
import { insertParticipant } from "@/modules/analytics/test-support";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { snapshotGoalsForParticipant } from "@/modules/review-core/goal-snapshot";
import { runGoalIngest } from "./ingest";
import { resetGoalTables } from "./test-support";

/*
 * Coexistence with Bamboo (#106): a goal written in the app that Bamboo also
 * has (same owner, same title once normalised) is overwritten by the goals
 * ingest, never duplicated, and counted as `nativeOverwritten`.
 */

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");
let dir: string;

const reset = async () => {
  await db.execute(sql`TRUNCATE review_cycle CASCADE`);
  await resetGoalTables();
};

const personByName = async (displayName: string) => {
  const [row] = await db
    .select()
    .from(person)
    .where(eq(person.displayName, displayName));
  return row;
};

async function nativeGoal(personId: string, title: string) {
  const [row] = await db
    .insert(goal)
    .values({
      personId,
      title,
      percentComplete: 10,
      status: "in_progress",
      dueDate: "2026-12-31",
      sourceSystem: "native",
    })
    .returning();
  return row;
}

const ingestGoals = () =>
  runGoalIngest({ adapter: new FixtureAdapter(dir), db });

describe("goals ingest over native goals (#106)", () => {
  beforeEach(async () => {
    await reset();
    dir = await mkdtemp(path.join(tmpdir(), "goals-coexist-"));
    await cp(FIXTURES, dir, { recursive: true });
    await runIngest({
      adapter: new FixtureAdapter(dir),
      entity: "employee",
      db,
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("overwrites the native goal with the same owner and title, keeping its row", async () => {
    const ana = await personByName("Ana García");
    // Case, accents and spacing do not make it another goal.
    const native = await nativeGoal(
      ana.id,
      "  definir el PLAN de carrera   del area ",
    );
    await db.insert(goalMilestone).values({
      goalId: native.id,
      title: "Hito nativo",
      position: 0,
      sourceSystem: "native",
    });

    const { counts } = await ingestGoals();

    expect(counts).toMatchObject({
      read: 5,
      inserted: 4,
      updated: 1,
      nativeOverwritten: 1,
    });
    const goals = await db.select().from(goal);
    expect(goals).toHaveLength(5);
    const [kept] = await db.select().from(goal).where(eq(goal.id, native.id));
    expect(kept).toMatchObject({
      sourceSystem: "bamboo_api",
      sourceId: "9001",
      title: "Definir el plan de carrera del área",
      percentComplete: 50,
      dueDate: "2026-12-15",
    });
    // Bamboo's milestones replace the ones written in the app.
    const live = await db
      .select({ title: goalMilestone.title })
      .from(goalMilestone)
      .where(
        and(
          eq(goalMilestone.goalId, native.id),
          sql`${goalMilestone.deletedAt} is null`,
        ),
      );
    expect(live.map((m) => m.title)).not.toContain("Hito nativo");
    expect(live.length).toBeGreaterThan(0);
  });

  it("is idempotent: the next run finds the goal by its Bamboo id", async () => {
    const ana = await personByName("Ana García");
    await nativeGoal(ana.id, "Definir el plan de carrera del área");
    await ingestGoals();
    const { counts } = await ingestGoals();
    expect(counts).toMatchObject({ read: 5, inserted: 0, unchanged: 5 });
    expect(counts.nativeOverwritten).toBeUndefined();
    expect(await db.select().from(goal)).toHaveLength(5);
  });

  it("leaves native goals of another owner or another title alone", async () => {
    const ana = await personByName("Ana García");
    const bruno = await personByName("Bruno Pérez");
    const other = await nativeGoal(ana.id, "Aprender portugués");
    const notHers = await nativeGoal(
      bruno.id,
      "Definir el plan de carrera del área",
    );
    const { counts } = await ingestGoals();
    expect(counts).toMatchObject({ inserted: 5, updated: 0 });
    expect(counts.nativeOverwritten).toBeUndefined();
    for (const g of [other, notHers]) {
      const [row] = await db.select().from(goal).where(eq(goal.id, g.id));
      expect(row.sourceSystem).toBe("native");
    }
  });

  it("re-keys the goal's cycle snapshots and refreshes them in open cycles", async () => {
    const ana = await personByName("Ana García");
    const bruno = await personByName("Bruno Pérez");
    const native = await nativeGoal(
      ana.id,
      "Definir el plan de carrera del área",
    );
    const cycleOf = async (status: "collecting" | "closed") => {
      const [row] = await db
        .insert(reviewCycle)
        .values({
          name: `Ciclo ${status}`,
          periodStart: "2026-07-01",
          periodEnd: "2026-12-31",
          snapshotDate: "2026-07-01",
          status,
          components: {
            self: true,
            manager: true,
            peer: false,
            upward: false,
            calibration: false,
          },
          anonymity: { peer: "transparent", upward: "transparent" },
        })
        .returning({ id: reviewCycle.id });
      const participantId = await insertParticipant({
        cycleId: row.id,
        personId: ana.id,
        snapManagerPersonId: bruno.id,
      });
      await snapshotGoalsForParticipant(db, participantId);
      return participantId;
    };
    const open = await cycleOf("collecting");
    const closed = await cycleOf("closed");

    await ingestGoals();

    const rows = await db
      .select()
      .from(participantGoalSnapshot)
      .where(eq(participantGoalSnapshot.goalId, native.id));
    expect(rows).toHaveLength(2);
    const byParticipant = new Map(rows.map((r) => [r.participantId, r]));
    // One goal, one key: no duplicate when Bamboo's goal is snapshotted again.
    expect(byParticipant.get(open)).toMatchObject({
      goalSourceKey: "bamboo_api:9001",
      percentComplete: 50,
    });
    // A closed cycle keeps its figures (history) under the new key.
    expect(byParticipant.get(closed)).toMatchObject({
      goalSourceKey: "bamboo_api:9001",
      percentComplete: 10,
    });
  });
});
