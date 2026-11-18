import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { closeDb, db } from "@/db/client";
import { goal, goalMilestone } from "@/db/schema";
import {
  employmentIdOf,
  insertGoal,
  insertJob,
  insertPerson,
  resetAll,
} from "@/modules/analytics/test-support";

/*
 * The server actions are callable without opening the page, so each one has
 * to enforce who may edit a goal by itself: these tests call them as the
 * actor of the cookie and look at what the database holds afterwards.
 */

const get = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const actions = await import("./actions");

const actAs = (role: string, personId: string | null | undefined) =>
  get.mockReturnValue({ value: JSON.stringify({ personId, role }) });

let ids: { ana: string; bruno: string; dora: string; eli: string };
let doraGoal: string;
let doraMilestone: string;

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

const read = async () =>
  (await db.select().from(goal).where(eq(goal.id, doraGoal)))[0];

beforeAll(async () => {
  await resetAll();
  const ana = await person("Ana Prieto", "1");
  const bruno = await person("Bruno Gil", "2", ana);
  const dora = await person("Dora Díaz", "3", bruno);
  const eli = await person("Eli Roca", "4", ana);
  ids = { ana, bruno, dora, eli };
});
beforeEach(async () => {
  get.mockReset();
  doraGoal = await insertGoal(ids.dora, "Goal de Dora");
  await db
    .update(goal)
    .set({ sourceSystem: "native", sourceId: null })
    .where(eq(goal.id, doraGoal));
  [{ id: doraMilestone }] = await db
    .insert(goalMilestone)
    .values({ goalId: doraGoal, title: "Primer hito", sourceSystem: "native" })
    .returning({ id: goalMilestone.id });
});
afterAll(async () => {
  await resetAll();
  await closeDb();
});

/** Every write of the screen, as called with the goal of Dora. */
const writes = () => [
  actions.updateGoalAction(doraGoal, { title: "Otro título" }),
  actions.setProgressAction(doraGoal, 90),
  actions.setStatusAction(doraGoal, "completed"),
  actions.addMilestoneAction(doraGoal, "Hito nuevo"),
  actions.setMilestoneDoneAction(doraMilestone, true),
];

describe("goal server actions", () => {
  it.each([
    ["an employee who is not the owner", "employee", "eli"],
    ["a manager who is not her manager", "manager", "eli"],
    ["the manager of her manager", "manager", "ana"],
    ["direction", "direction", null],
  ] as const)("refuse %s and write nothing", async (_who, role, who) => {
    actAs(role, who && ids[who]);
    const results = await Promise.all(writes());
    expect(results.map((r) => r.ok)).toEqual(Array(5).fill(false));
    for (const r of results) {
      expect(r).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect(await read()).toMatchObject({
      title: "Goal de Dora",
      percentComplete: 0,
      status: "in_progress",
    });
    const milestones = await db
      .select()
      .from(goalMilestone)
      .where(eq(goalMilestone.goalId, doraGoal));
    expect(milestones).toHaveLength(1);
    expect(milestones[0].completedAt).toBeNull();
  });

  it("refuses to create a goal for somebody else", async () => {
    actAs("employee", ids.eli);
    expect(
      await actions.createGoalAction({ title: "x", personId: ids.dora }),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });

  it.each([
    ["the owner", "employee", "dora"],
    ["her manager", "manager", "bruno"],
    ["People", "hr", null],
  ] as const)("let %s edit it", async (_who, role, who) => {
    actAs(role, who && ids[who]);
    for (const r of await Promise.all([
      actions.updateGoalAction(doraGoal, { title: "Otro título" }),
      actions.setProgressAction(doraGoal, 90),
      actions.addMilestoneAction(doraGoal, "Hito nuevo"),
      actions.setMilestoneDoneAction(doraMilestone, true),
    ])) {
      expect(r).toMatchObject({ ok: true });
    }
    expect(await actions.setStatusAction(doraGoal, "completed")).toMatchObject({
      ok: true,
    });
    expect(await read()).toMatchObject({
      title: "Otro título",
      percentComplete: 100,
      status: "completed",
    });
  });

  it("lets a manager create a goal for a direct report", async () => {
    actAs("manager", ids.bruno);
    const created = await actions.createGoalAction({
      title: "Del manager",
      personId: ids.dora,
    });
    expect(created).toMatchObject({ ok: true });
    const [row] = await db
      .select()
      .from(goal)
      .where(eq(goal.title, "Del manager"));
    expect(row).toMatchObject({ personId: ids.dora, sourceSystem: "native" });
  });
});
