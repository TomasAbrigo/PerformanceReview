import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  goal,
  goalComment,
  goalMilestone,
  participantGoalSnapshot,
  reviewCycle,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  employmentIdOf,
  insertCycle,
  insertJob,
  insertParticipant,
  insertPerson,
  resetAll,
} from "@/modules/analytics/test-support";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import { ReviewError } from "@/modules/review-core/review-errors";
import {
  getGoalDetail,
  goalFilterOptions,
  listGoalCycles,
  listGoals,
} from "./browse";

const TODAY = "2026-11-18";

/**
 * Ana (CEO) <- Bruno <- Dora and Eli; Zoe reports to Ana. Goals:
 *   Dora  "Migrar la API" in progress, due 2026-12-31, 2 milestones (1 done), 1 comment
 *   Dora  "Documentar" completed
 *   Dora  "Capacitar al equipo" in progress, due 2026-01-31 (overdue)
 *   Dora  "Borrado" deleted
 *   Eli   "Mejorar el onboarding" closed
 *   Bruno "Armar el plan" in progress, no due date
 *   Zoe   "Cerrar el trimestre" in progress, due 2027-03-31
 */
let ids: {
  ana: string;
  bruno: string;
  dora: string;
  eli: string;
  zoe: string;
  migrar: string;
  documentar: string;
  capacitar: string;
  onboarding: string;
  plan: string;
  trimestre: string;
  cycleId: string;
  pDora: string;
};

const hr: ActorContext = { personId: null, role: "hr" };
const as = (role: ActorContext["role"], personId: string): ActorContext => ({
  role,
  personId,
});

async function person(
  name: string,
  bambooId: string,
  manager?: string,
  dept = "Tecnología",
) {
  const id = await insertPerson({ displayName: name, bambooId });
  await insertJob({
    personId: id,
    validFrom: "2020-01-01",
    managerPersonId: manager ?? null,
    employmentId: await employmentIdOf(id),
    department: dept,
  });
  return id;
}

async function insertGoal(
  personId: string,
  title: string,
  g: Partial<typeof goal.$inferInsert> = {},
) {
  const [row] = await db
    .insert(goal)
    .values({ personId, title, sourceSystem: "native", ...g })
    .returning({ id: goal.id });
  return row.id;
}

beforeAll(async () => {
  await resetAll();
  const ana = await person("Ana Prieto", "1");
  const bruno = await person("Bruno Gil", "2", ana);
  const dora = await person("Dora Díaz", "3", bruno, "Producto");
  const eli = await person("Eli Roca", "4", bruno);
  const zoe = await person("Zoe Luna", "5", ana);
  await setOrgAttributes(dora, { dm: "Dana DM", account: "Acme" });
  await setOrgAttributes(eli, { dm: "Otro DM" });

  const migrar = await insertGoal(dora, "Migrar la API", {
    percentComplete: 50,
    dueDate: "2026-12-31",
    description: "Pasar todo a la v2",
  });
  const documentar = await insertGoal(dora, "Documentar", {
    status: "completed",
    percentComplete: 100,
    dueDate: "2026-06-30",
    completionDate: "2026-06-20",
  });
  const capacitar = await insertGoal(dora, "Capacitar al equipo", {
    percentComplete: 20,
    dueDate: "2026-01-31",
  });
  await insertGoal(dora, "Borrado", { deletedAt: new Date() });
  const onboarding = await insertGoal(eli, "Mejorar el onboarding", {
    status: "closed",
  });
  const plan = await insertGoal(bruno, "Armar el plan");
  const trimestre = await insertGoal(zoe, "Cerrar el trimestre", {
    dueDate: "2027-03-31",
  });
  await db.insert(goalMilestone).values([
    {
      goalId: migrar,
      title: "Endpoints",
      position: 0,
      completedAt: new Date("2026-08-01T12:00:00Z"),
    },
    { goalId: migrar, title: "Datos", position: 1 },
  ]);
  await db.insert(goalComment).values({
    goalId: migrar,
    authorPersonId: bruno,
    text: "Va bien",
    postedAt: new Date("2026-09-01T12:00:00Z"),
  });

  // The first semester's cycle snapshots Dora's first two goals.
  const cycleId = await insertCycle("Primer semestre");
  await db
    .update(reviewCycle)
    .set({ status: "closed" })
    .where(eq(reviewCycle.id, cycleId));
  const pDora = await insertParticipant({
    cycleId,
    personId: dora,
    snapManagerPersonId: bruno,
  });
  await db.insert(participantGoalSnapshot).values([
    {
      participantId: pDora,
      goalId: migrar,
      goalSourceKey: `native:${migrar}`,
      title: "Migrar la API",
      status: "in_progress",
      percentComplete: 10,
    },
    {
      participantId: pDora,
      goalId: documentar,
      goalSourceKey: `native:${documentar}`,
      title: "Documentar",
      status: "completed",
      percentComplete: 100,
    },
  ]);
  ids = {
    ana,
    bruno,
    dora,
    eli,
    zoe,
    migrar,
    documentar,
    capacitar,
    onboarding,
    plan,
    trimestre,
    cycleId,
    pDora,
  };
});
afterAll(async () => {
  await resetAll();
  await closeDb();
});

const titles = (page: { items: { title: string }[] }) =>
  page.items.map((g) => g.title);

describe("listGoals: who reads which goals", () => {
  it("gives People every live goal, with the counts per state", async () => {
    const page = await listGoals(db, hr, {}, TODAY);
    expect(page.total).toBe(6);
    expect(page.counts).toEqual({
      in_progress: 3,
      completed: 1,
      closed: 1,
      overdue: 1,
    });
    expect(titles(page)).not.toContain("Borrado");
  });

  it("orders by state (overdue, in progress, completed, closed), then due date, the ones without one last", async () => {
    const page = await listGoals(db, hr, {}, TODAY);
    expect(titles(page)).toEqual([
      "Capacitar al equipo",
      "Migrar la API",
      "Cerrar el trimestre",
      "Armar el plan",
      "Documentar",
      "Mejorar el onboarding",
    ]);
  });

  it("gives a manager their direct reports and themself, not the rest", async () => {
    const page = await listGoals(db, as("manager", ids.bruno), {}, TODAY);
    expect(titles(page).sort()).toEqual([
      "Armar el plan",
      "Capacitar al equipo",
      "Documentar",
      "Mejorar el onboarding",
      "Migrar la API",
    ]);
  });

  it("gives an employee only their own goals", async () => {
    const dora = await listGoals(db, as("employee", ids.dora), {}, TODAY);
    expect(titles(dora).sort()).toEqual([
      "Capacitar al equipo",
      "Documentar",
      "Migrar la API",
    ]);
    const eli = await listGoals(db, as("employee", ids.eli), {}, TODAY);
    expect(titles(eli)).toEqual(["Mejorar el onboarding"]);
  });

  it("gives a manager with no reports only their own goals", async () => {
    const zoe = await listGoals(db, as("manager", ids.zoe), {}, TODAY);
    expect(titles(zoe)).toEqual(["Cerrar el trimestre"]);
  });

  it("refuses direction and an actor without a person", async () => {
    for (const actor of [
      { personId: null, role: "direction" },
      { personId: null, role: "manager" },
      { personId: null, role: "employee" },
    ] as ActorContext[]) {
      await expect(listGoals(db, actor, {}, TODAY)).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });
});

describe("listGoals: filters", () => {
  it("filters by state, overdue included", async () => {
    expect(
      titles(await listGoals(db, hr, { state: "overdue" }, TODAY)),
    ).toEqual(["Capacitar al equipo"]);
    const inProgress = await listGoals(db, hr, { state: "in_progress" }, TODAY);
    expect(titles(inProgress)).toEqual([
      "Migrar la API",
      "Cerrar el trimestre",
      "Armar el plan",
    ]);
    // The chips keep counting the whole filtered set, not the chosen state.
    expect(inProgress.counts.completed).toBe(1);
    expect(inProgress.total).toBe(3);
  });

  it("searches the owner by name, as typed (no wildcards)", async () => {
    expect(titles(await listGoals(db, hr, { q: "dora" }, TODAY))).toHaveLength(
      3,
    );
    expect((await listGoals(db, hr, { q: "%" }, TODAY)).total).toBe(0);
  });

  it("searches the goal title too", async () => {
    expect(titles(await listGoals(db, hr, { q: "trimestre" }, TODAY))).toEqual([
      "Cerrar el trimestre",
    ]);
  });

  it("filters by the goals of a cycle's snapshot", async () => {
    const page = await listGoals(db, hr, { cycleId: ids.cycleId }, TODAY);
    expect(titles(page).sort()).toEqual(["Documentar", "Migrar la API"]);
    expect((await listGoals(db, hr, { cycleId: "nope" }, TODAY)).total).toBe(0);
  });

  it("filters by the owner's area and org attributes", async () => {
    expect(
      titles(await listGoals(db, hr, { department: "Producto" }, TODAY)),
    ).toHaveLength(3);
    expect(titles(await listGoals(db, hr, { dm: "Otro DM" }, TODAY))).toEqual([
      "Mejorar el onboarding",
    ]);
    expect(
      (await listGoals(db, hr, { account: "Acme", dm: "Dana DM" }, TODAY))
        .total,
    ).toBe(3);
  });

  it("is the last page for a page past it, never an empty one", async () => {
    const wild = await listGoals(db, hr, { page: 10 ** 12 }, TODAY);
    expect(wild.page).toBe(1);
    expect(wild.items).toHaveLength(6);
    expect(wild.total).toBe(6);
  });

  it("carries the milestone counts and the owner", async () => {
    const page = await listGoals(
      db,
      hr,
      { q: "dora", state: "in_progress" },
      TODAY,
    );
    expect(page.items[0]).toMatchObject({
      title: "Migrar la API",
      percentComplete: 50,
      dueDate: "2026-12-31",
      milestonesTotal: 2,
      milestonesDone: 1,
      department: "Producto",
      person: { id: ids.dora, name: "Dora Díaz" },
    });
  });
});

describe("goalFilterOptions", () => {
  it("offers what the goals in scope carry", async () => {
    const all = await goalFilterOptions(db, hr, TODAY);
    expect(all.departments).toEqual(["Producto", "Tecnología"]);
    expect(all.org.dms).toEqual(["Dana DM", "Otro DM"]);
    const bruno = await goalFilterOptions(db, as("manager", ids.bruno), TODAY);
    expect(bruno.org.accounts).toEqual(["Acme"]);
    const zoe = await goalFilterOptions(db, as("employee", ids.zoe), TODAY);
    expect(zoe.departments).toEqual(["Tecnología"]);
    expect(zoe.org.dms).toEqual([]);
  });
});

describe("getGoalDetail", () => {
  it("gives People any goal, with its milestones, comments and the cycles it is part of", async () => {
    const detail = await getGoalDetail(db, hr, ids.migrar, TODAY);
    expect(detail).toMatchObject({
      title: "Migrar la API",
      description: "Pasar todo a la v2",
      state: "in_progress",
      percentComplete: 50,
      dueDate: "2026-12-31",
      person: { name: "Dora Díaz" },
    });
    expect(detail?.milestones.map((m) => [m.title, !!m.completedAt])).toEqual([
      ["Endpoints", true],
      ["Datos", false],
    ]);
    expect(detail?.comments).toMatchObject([
      { author: "Bruno Gil", text: "Va bien" },
    ]);
    expect(detail?.appearances).toMatchObject([
      {
        cycleName: "Primer semestre",
        participantId: ids.pDora,
        revieweePersonId: ids.dora,
        snapManagerPersonId: ids.bruno,
      },
    ]);
  });

  it("marks an overdue goal", async () => {
    expect((await getGoalDetail(db, hr, ids.capacitar, TODAY))?.state).toBe(
      "overdue",
    );
  });

  it("lets the owner and their manager read it, and nobody else", async () => {
    expect(
      await getGoalDetail(db, as("employee", ids.dora), ids.migrar, TODAY),
    ).not.toBeNull();
    expect(
      await getGoalDetail(db, as("manager", ids.bruno), ids.migrar, TODAY),
    ).not.toBeNull();
    for (const actor of [
      as("employee", ids.eli),
      as("manager", ids.zoe),
      as("manager", ids.eli),
      { personId: null, role: "direction" } as ActorContext,
    ]) {
      await expect(
        getGoalDetail(db, actor, ids.migrar, TODAY),
      ).rejects.toBeInstanceOf(ReviewError);
    }
  });

  it("is null for an unknown, malformed or deleted goal", async () => {
    expect(await getGoalDetail(db, hr, "nope", TODAY)).toBeNull();
    expect(
      await getGoalDetail(
        db,
        hr,
        "00000000-0000-4000-8000-000000000000",
        TODAY,
      ),
    ).toBeNull();
  });
});

describe("listGoalCycles", () => {
  it("offers the cycles whose snapshot holds goals the actor may read", async () => {
    expect((await listGoalCycles(db, hr, TODAY)).map((c) => c.name)).toEqual([
      "Primer semestre",
    ]);
    // Dora's goals are in the snapshot: her manager and herself read them.
    for (const actor of [as("manager", ids.bruno), as("employee", ids.dora)]) {
      expect((await listGoalCycles(db, actor, TODAY)).map((c) => c.id)).toEqual(
        [ids.cycleId],
      );
    }
  });

  it("offers nothing to someone who cannot read those goals, so the filter never comes back empty", async () => {
    for (const actor of [as("employee", ids.eli), as("manager", ids.zoe)]) {
      expect(await listGoalCycles(db, actor, TODAY)).toEqual([]);
    }
    await expect(
      listGoalCycles(db, { personId: null, role: "direction" }, TODAY),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("agrees with the list: every offered cycle lists goals for that actor", async () => {
    for (const actor of [
      hr,
      as("manager", ids.bruno),
      as("employee", ids.dora),
    ]) {
      for (const c of await listGoalCycles(db, actor, TODAY)) {
        expect(
          (await listGoals(db, actor, { cycleId: c.id }, TODAY)).total,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe("listGoals: paging", () => {
  it("pages 25 at a time, reads the counts whole and clamps an out-of-range page", async () => {
    const extra = await db
      .insert(goal)
      .values(
        Array.from({ length: 30 }, (_, i) => ({
          personId: ids.zoe,
          title: `Extra ${String(i).padStart(2, "0")}`,
          sourceSystem: "native" as const,
          dueDate: `2030-01-${String((i % 28) + 1).padStart(2, "0")}`,
        })),
      )
      .returning({ id: goal.id });
    try {
      const first = await listGoals(db, as("employee", ids.zoe), {}, TODAY);
      expect(first.total).toBe(31);
      expect(first.items).toHaveLength(25);
      expect(first.page).toBe(1);
      const second = await listGoals(
        db,
        as("employee", ids.zoe),
        { page: 2 },
        TODAY,
      );
      expect(second.items).toHaveLength(6);
      const clamped = await listGoals(
        db,
        as("employee", ids.zoe),
        { page: 9 },
        TODAY,
      );
      expect(clamped.page).toBe(2);
      expect(clamped.items.map((g) => g.id)).toEqual(
        second.items.map((g) => g.id),
      );
      // No page repeats a goal of another.
      expect(
        new Set([...first.items, ...second.items].map((g) => g.id)).size,
      ).toBe(31);
    } finally {
      await db.delete(goal).where(
        inArray(
          goal.id,
          extra.map((e) => e.id),
        ),
      );
    }
  });
});
