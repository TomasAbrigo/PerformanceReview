import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  participantGoalSnapshot,
  reviewCycle,
} from "@/db/schema";
import {
  employmentIdOf,
  insertJob,
  insertParticipant,
  insertPerson,
  resetAll,
} from "@/modules/analytics/test-support";
import { goalKpis } from "@/modules/analytics/goals-insights";
import type { ActorContext } from "@/modules/actor/types";
import { snapshotGoalsForParticipant } from "@/modules/review-core/goal-snapshot";
import {
  addMilestone,
  createGoal,
  setProgress,
  setStatus,
  updateGoal,
} from "./write";

/*
 * What the goals a person writes do to the cycles that already hold a
 * snapshot of them: /insights/goals and the assessments read the snapshot,
 * so completing or closing a goal has to reach it (open cycles only: a
 * closed cycle is history).
 */

const TODAY = "2026-11-18";
const hr: ActorContext = { personId: null, role: "hr" };
const owner = (personId: string): ActorContext => ({
  role: "employee",
  personId,
});

let dora: string;
let bruno: string;
/** Open cycle running through today; closed one over the same span; open one long over. */
let open: string;
let closed: string;
let over: string;

async function cycle(
  name: string,
  status: "collecting" | "closed",
  periodStart: string,
  periodEnd: string,
) {
  const [row] = await db
    .insert(reviewCycle)
    .values({
      name,
      periodStart,
      periodEnd,
      snapshotDate: periodStart,
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
  return row.id;
}

/** Launches a cycle for Dora: her participant row and the snapshot of her goals. */
async function join(cycleId: string) {
  const participantId = await insertParticipant({
    cycleId,
    personId: dora,
    snapManagerPersonId: bruno,
  });
  await snapshotGoalsForParticipant(db, participantId);
  return participantId;
}

const cyclesOf = async (goalId: string) =>
  (
    await db
      .select({ cycleId: cycleParticipant.cycleId })
      .from(participantGoalSnapshot)
      .innerJoin(
        cycleParticipant,
        eq(cycleParticipant.id, participantGoalSnapshot.participantId),
      )
      .where(eq(participantGoalSnapshot.goalId, goalId))
  ).map((r) => r.cycleId);

const figures = async (cycleId: string) => {
  const { groups } = await goalKpis(db, hr, { cycleId, groupBy: "person" });
  return groups.find((g) => g.label === "Dora Díaz");
};

beforeAll(async () => {
  await resetAll();
  bruno = await insertPerson({ displayName: "Bruno Gil", bambooId: "2" });
  await insertJob({
    personId: bruno,
    validFrom: "2020-01-01",
    managerPersonId: null,
    employmentId: await employmentIdOf(bruno),
  });
  dora = await insertPerson({ displayName: "Dora Díaz", bambooId: "3" });
  await insertJob({
    personId: dora,
    validFrom: "2020-01-01",
    managerPersonId: bruno,
    employmentId: await employmentIdOf(dora),
  });
  open = await cycle("Abierto", "collecting", "2020-01-01", "2099-12-31");
  closed = await cycle("Cerrado", "closed", "2020-01-01", "2099-12-31");
  over = await cycle("Vencido", "collecting", "2020-01-01", "2020-06-30");
});
afterAll(async () => {
  await resetAll();
  await closeDb();
});

describe("goals written in the app and the cycles' goal snapshot", () => {
  it("reaches the open cycle when a goal is completed or closed, not the closed one", async () => {
    const { id } = await createGoal(
      db,
      owner(dora),
      { title: "Cerrar el release", dueDate: "2099-01-01" },
      TODAY,
    );
    // The cycles launch afterwards and snapshot the goal as it is.
    await join(open);
    await join(closed);
    await join(over);
    expect(await figures(open)).toMatchObject({
      goals: 1,
      inProgress: 1,
      completed: 0,
    });

    await setProgress(db, owner(dora), id, 40, TODAY);
    expect(await figures(open)).toMatchObject({ avgProgress: 40 });

    await setStatus(db, owner(dora), id, "completed", TODAY);
    expect(await figures(open)).toMatchObject({
      goals: 1,
      completed: 1,
      inProgress: 0,
      completedPct: 100,
      avgProgress: 100,
    });
    // History stays as it was.
    expect(await figures(closed)).toMatchObject({
      completed: 0,
      inProgress: 1,
      avgProgress: 0,
    });

    await setStatus(db, owner(dora), id, "closed", TODAY);
    expect(await figures(open)).toMatchObject({
      goals: 1,
      completed: 0,
      closed: 1,
    });
    await setStatus(db, owner(dora), id, "in_progress", TODAY);
    expect(await figures(open)).toMatchObject({ inProgress: 1, closed: 0 });
  });

  it("adds a goal created after the launch only to the open cycle it belongs to", async () => {
    const before = await figures(open);
    const { id } = await createGoal(
      db,
      owner(dora),
      { title: "Nuevo en el ciclo" },
      TODAY,
    );
    // The closed cycle is history and the other one ended before the goal began.
    expect(await cyclesOf(id)).toEqual([open]);
    expect((await figures(open))?.goals).toBe((before?.goals ?? 0) + 1);
    expect((await figures(closed))?.goals).toBe(1);
    expect((await figures(over))?.goals).toBe(0);
  });

  it("stamps the refresh date and follows the title and due date", async () => {
    const { id } = await createGoal(
      db,
      owner(dora),
      { title: "Con fecha" },
      TODAY,
    );
    const rows = () =>
      db
        .select()
        .from(participantGoalSnapshot)
        .where(eq(participantGoalSnapshot.goalId, id));
    expect(await rows()).toMatchObject([
      { title: "Con fecha", dueDate: null, refreshedAt: null },
    ]);
    await updateGoal(
      db,
      owner(dora),
      id,
      { title: "Con otro título", dueDate: "2020-03-01" },
      TODAY,
    );
    const [row, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      title: "Con otro título",
      dueDate: "2020-03-01",
    });
    expect(row.refreshedAt).toBeInstanceOf(Date);
  });

  it("does not touch a snapshot for a milestone", async () => {
    const { id } = await createGoal(
      db,
      owner(dora),
      { title: "Con hitos" },
      TODAY,
    );
    const stamp = async () =>
      (
        await db
          .select({ at: participantGoalSnapshot.refreshedAt })
          .from(participantGoalSnapshot)
          .where(eq(participantGoalSnapshot.goalId, id))
      ).map((r) => r.at);
    const first = await stamp();
    await addMilestone(db, owner(dora), id, { title: "Hito" }, TODAY);
    expect(await stamp()).toEqual(first);
  });
});
