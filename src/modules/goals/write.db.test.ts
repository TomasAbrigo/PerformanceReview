import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { goal, goalMilestone } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  employmentIdOf,
  insertJob,
  insertPerson,
  resetAll,
} from "@/modules/analytics/test-support";
import { listGoals } from "./browse";
import {
  addMilestone,
  createGoal,
  GoalError,
  listGoalOwnerOptions,
  setMilestoneDone,
  setProgress,
  setStatus,
  updateGoal,
} from "./write";

const TODAY = "2026-11-18";
const hr: ActorContext = { personId: null, role: "hr" };
const as = (role: ActorContext["role"], personId: string): ActorContext => ({
  role,
  personId,
});

/** Ana <- Bruno <- Dora; Eli reports to Ana (Bruno is not his manager). */
let p: { ana: string; bruno: string; dora: string; eli: string };

async function person(name: string, bambooId: string, manager?: string) {
  const id = await insertPerson({ displayName: name, bambooId });
  await insertJob({
    personId: id,
    validFrom: "2020-01-01",
    managerPersonId: manager ?? null,
    employmentId: await employmentIdOf(id),
  });
  return id;
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => (e instanceof GoalError ? e.code : "other"),
  );

beforeAll(async () => {
  await resetAll();
  const ana = await person("Ana Prieto", "1");
  const bruno = await person("Bruno Gil", "2", ana);
  const dora = await person("Dora Díaz", "3", bruno);
  const eli = await person("Eli Roca", "4", ana);
  p = { ana, bruno, dora, eli };
});
afterAll(async () => {
  await closeDb();
});

const read = async (id: string) =>
  (await db.select().from(goal).where(eq(goal.id, id)))[0];

describe("createGoal", () => {
  it("creates a native goal for the actor", async () => {
    const { id } = await createGoal(
      db,
      as("employee", p.dora),
      { title: "  Mi goal ", description: "", dueDate: "2026-12-31" },
      TODAY,
    );
    const row = await read(id);
    expect(row).toMatchObject({
      personId: p.dora,
      title: "Mi goal",
      description: null,
      dueDate: "2026-12-31",
      status: "in_progress",
      percentComplete: 0,
      sourceSystem: "native",
    });
  });

  it("lets a manager create one for a direct report, People for anyone", async () => {
    const a = await createGoal(
      db,
      as("manager", p.bruno),
      { title: "Para Dora", personId: p.dora },
      TODAY,
    );
    expect((await read(a.id)).personId).toBe(p.dora);
    const b = await createGoal(db, hr, { title: "HR", personId: p.eli }, TODAY);
    expect((await read(b.id)).personId).toBe(p.eli);
  });

  it("refuses a manager for a non-report, an employee for someone else and direction", async () => {
    expect(
      await code(
        createGoal(
          db,
          as("manager", p.bruno),
          { title: "x", personId: p.eli },
          TODAY,
        ),
      ),
    ).toBe("forbidden");
    expect(
      await code(
        createGoal(
          db,
          as("employee", p.dora),
          { title: "x", personId: p.eli },
          TODAY,
        ),
      ),
    ).toBe("forbidden");
    expect(
      await code(
        createGoal(
          db,
          { personId: null, role: "direction" },
          { title: "x", personId: p.dora },
          TODAY,
        ),
      ),
    ).toBe("forbidden");
  });

  it("validates the input and needs an owner", async () => {
    expect(
      await code(createGoal(db, as("employee", p.dora), { title: " " }, TODAY)),
    ).toBe("validation");
    expect(
      await code(
        createGoal(
          db,
          as("employee", p.dora),
          { title: "x", dueDate: "nope" },
          TODAY,
        ),
      ),
    ).toBe("validation");
    expect(await code(createGoal(db, hr, { title: "x" }, TODAY))).toBe(
      "validation",
    );
  });
});

describe("editing", () => {
  it("update, progress, milestones and status follow the same rule", async () => {
    const { id } = await createGoal(
      db,
      as("employee", p.dora),
      { title: "A editar" },
      TODAY,
    );
    const owner = as("employee", p.dora);
    const boss = as("manager", p.bruno);
    const stranger = as("employee", p.eli);
    const notBoss = as("manager", p.eli);

    await updateGoal(
      db,
      owner,
      id,
      { title: "Editado", dueDate: "2026-10-01" },
      TODAY,
    );
    await setProgress(db, boss, id, 40, TODAY);
    expect(await read(id)).toMatchObject({
      title: "Editado",
      percentComplete: 40,
    });

    for (const who of [
      stranger,
      notBoss,
      { personId: null, role: "direction" } as ActorContext,
    ]) {
      expect(await code(updateGoal(db, who, id, { title: "x" }, TODAY))).toBe(
        "forbidden",
      );
      expect(await code(setProgress(db, who, id, 10, TODAY))).toBe("forbidden");
      expect(await code(setStatus(db, who, id, "closed", TODAY))).toBe(
        "forbidden",
      );
      expect(await code(addMilestone(db, who, id, { title: "x" }, TODAY))).toBe(
        "forbidden",
      );
    }
    expect((await read(id)).title).toBe("Editado");

    expect(await code(setProgress(db, owner, id, 101, TODAY))).toBe(
      "validation",
    );
    expect(await code(setProgress(db, owner, id, 1.5, TODAY))).toBe(
      "validation",
    );

    const m1 = await addMilestone(db, owner, id, { title: "Uno" }, TODAY);
    const m2 = await addMilestone(db, boss, id, { title: "Dos" }, TODAY);
    const rows = await db
      .select()
      .from(goalMilestone)
      .where(eq(goalMilestone.goalId, id));
    expect(
      rows.map((r) => [r.title, r.position, r.sourceSystem]).sort(),
    ).toEqual([
      ["Dos", 1, "native"],
      ["Uno", 0, "native"],
    ]);
    await setMilestoneDone(db, owner, m1.id, true, TODAY);
    expect(
      (
        await db.select().from(goalMilestone).where(eq(goalMilestone.id, m1.id))
      )[0].completedAt,
    ).not.toBeNull();
    expect(await code(setMilestoneDone(db, stranger, m2.id, true, TODAY))).toBe(
      "forbidden",
    );
    await setMilestoneDone(db, owner, m1.id, false, TODAY);
    expect(
      (
        await db.select().from(goalMilestone).where(eq(goalMilestone.id, m1.id))
      )[0].completedAt,
    ).toBeNull();
  });

  it("reports unknown goals and milestones as not found", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await code(setProgress(db, hr, missing, 1, TODAY))).toBe(
      "not_found",
    );
    expect(await code(setProgress(db, hr, "nope", 1, TODAY))).toBe("not_found");
    expect(await code(setMilestoneDone(db, hr, missing, true, TODAY))).toBe(
      "not_found",
    );
  });
});

describe("status", () => {
  it("completes, closes and reopens, and the list reflects it", async () => {
    const owner = as("employee", p.dora);
    const { id } = await createGoal(
      db,
      owner,
      { title: "Con estados", dueDate: "2026-01-01" },
      TODAY,
    );
    const stateOf = async () =>
      (await listGoals(db, hr, { q: "Dora" }, TODAY)).items.find(
        (g) => g.id === id,
      )?.state;

    expect(await stateOf()).toBe("overdue");
    await setStatus(db, owner, id, "completed", TODAY);
    expect(await read(id)).toMatchObject({
      status: "completed",
      completionDate: TODAY,
      percentComplete: 100,
    });
    expect(await stateOf()).toBe("completed");

    await setStatus(db, owner, id, "closed", TODAY);
    expect(await read(id)).toMatchObject({
      status: "closed",
      completionDate: null,
    });
    expect(await stateOf()).toBe("closed");

    await setStatus(db, as("manager", p.bruno), id, "in_progress", TODAY);
    expect(await read(id)).toMatchObject({
      status: "in_progress",
      completionDate: null,
    });
    expect(await stateOf()).toBe("overdue");
    expect(await code(setStatus(db, owner, id, "weird", TODAY))).toBe(
      "validation",
    );
  });
});

describe("listGoalOwnerOptions", () => {
  it("offers who the actor may create goals for", async () => {
    const names = async (a: ActorContext) =>
      (await listGoalOwnerOptions(db, a, TODAY)).map((o) => o.name);
    expect(await names(as("employee", p.dora))).toEqual(["Dora Díaz"]);
    expect(await names(as("manager", p.bruno))).toEqual([
      "Bruno Gil",
      "Dora Díaz",
    ]);
    expect(await names({ personId: null, role: "direction" })).toEqual([]);
    expect(await names(hr)).toHaveLength(4);
  });
});
