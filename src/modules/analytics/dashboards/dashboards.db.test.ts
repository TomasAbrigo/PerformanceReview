import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  participantGoalSnapshot,
  person,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { exportCsv } from "@/modules/exports/entities";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { finalScale } from "@/modules/review-core";
import {
  addRating,
  answerRequest,
  createTestCycle,
  requestIdOf,
  setStatus,
  type TestCycleInput,
} from "@/modules/review-core/test-support";
import { setSetting } from "@/modules/settings";
import {
  addQuestion,
  addSection,
  createScale,
  createTemplate,
  listScales,
  seedSystemTemplates,
} from "@/modules/templates";
import {
  cycleProgress,
  dashboardFilterOptions,
  executiveSummary,
  goalsVsRating,
  ratingDistribution,
  selfManagerGap,
} from ".";
import { insertJob, insertPerson } from "../test-support";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

// Job history: at 2022-06-01 Bruno (Developer, Rosario) reports to Carla
// (Engineering Manager, Córdoba), Carla to Ana. Since 2023-01-01 (so today)
// Bruno is a Senior Developer reporting to Ana; Carla left on 2024-06-30,
// so today she has no current job row (current dimensions are null).
let ana: string;
let bruno: string;
let carla: string;
let templateId: string;
let q1: string; // rating 1..5 (self + manager): normalized (v-1)/4
let overall: string; // overall rating 1..4 (manager): normalized (v-1)/3

const hr: ActorContext = { personId: null, role: "hr" };
const as = (
  personId: string,
  role: ActorContext["role"] = "employee",
): ActorContext => ({ personId, role });

async function reset() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run, app_setting, admin_audit_log CASCADE`,
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
  const five = await createScale(db, {
    name: { es: "Dash 5", en: "Dash 5" },
    options: [1, 2, 3, 4, 5].map((v) => ({
      value: v,
      label: { es: `N${v}`, en: `L${v}` },
    })),
  });
  const four = (await listScales(db)).find(
    (s) => s.systemKey === "four_point_descriptive",
  )!;
  const t = await createTemplate(db, {
    name: { es: "Dashboards", en: "Dashboards" },
  });
  templateId = t.id;
  const s = await addSection(db, t.id, { title: { es: "S", en: "S" } });
  await addQuestion(db, s.id, {
    kind: "rating",
    appliesTo: ["self", "manager"],
    prompt: { es: "Colaboración", en: "Collaboration" },
    scaleId: five.id,
  });
  await addQuestion(db, s.id, {
    kind: "rating",
    appliesTo: ["manager"],
    prompt: { es: "Rating general", en: "Overall rating" },
    scaleId: four.id,
    role: "overall_rating",
  });
});

beforeEach(async () => {
  await reset();
  const dir = await mkdtemp(path.join(tmpdir(), "dashboards-"));
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

const input = (overrides: Partial<TestCycleInput> = {}): TestCycleInput => ({
  name: "H1 2022",
  periodStart: "2022-01-01",
  periodEnd: "2022-06-30",
  snapshotDate: "2022-06-01",
  components: { calibration: true },
  templateId,
  personIds: [bruno, carla],
  ...overrides,
});

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

async function questionIds(cycleId: string) {
  const rows = await db.execute<{ id: string; role: string | null }>(
    sql`select id, role from question_revision where cycle_id = ${cycleId}`,
  );
  q1 = rows.find((r) => r.role === null)!.id;
  overall = rows.find((r) => r.role === "overall_rating")!.id;
}

/** Answers (and optionally submits) the self review: Q1 only. */
async function selfReview(
  cycleId: string,
  who: string,
  value: number,
  done: boolean,
) {
  const p = await participantOf(cycleId, who);
  const id = await requestIdOf(p.id, "self");
  await answerRequest(id, (q) => (q.id === q1 ? value : null), {
    submit: done,
  });
}

/** Submits the manager review: Q1 and the overall rating (final_rating `manager`). */
async function managerReview(
  cycleId: string,
  reviewee: string,
  manager: string,
  value: number,
  rating: number,
) {
  const p = await participantOf(cycleId, reviewee);
  const id = await requestIdOf(p.id, "manager", manager);
  await answerRequest(id, (q) =>
    q.id === q1 ? value : q.id === overall ? rating : null,
  );
  return p.id;
}

/**
 * H1 2022: Bruno self Q1=4 (0.75, submitted); Carla self Q1=2 (draft);
 * Carla rates Bruno Q1=3 (0.5), overall 2 (1/3); Ana rates Carla Q1=5,
 * overall 4 (1). HR calibrates Bruno to 3 (2/3).
 */
async function h1() {
  const cycle = await createTestCycle(input());
  await questionIds(cycle.id);
  await selfReview(cycle.id, bruno, 4, true);
  await selfReview(cycle.id, carla, 2, false);
  const pb = await managerReview(cycle.id, bruno, carla, 3, 2);
  const pc = await managerReview(cycle.id, carla, ana, 5, 4);
  await setStatus(cycle.id, "calibration");
  const three = (await finalScale(db, cycle.id)).find((o) => o.value === 3)!;
  await addRating(pb, "calibrated", 3, {
    label: three.label.es,
    normalized: three.normalized,
    reason: "Impacto",
  });
  return { cycle, pb, pc };
}

/** H1 2024 (snapshot 2024-02-01): only Bruno; Ana rates overall 4 (1). */
async function h2024() {
  const cycle = await createTestCycle(
    input({
      name: "H1 2024",
      periodStart: "2024-01-01",
      periodEnd: "2024-06-30",
      snapshotDate: "2024-02-01",
      personIds: [bruno],
    }),
  );
  await questionIds(cycle.id);
  await managerReview(cycle.id, bruno, ana, 5, 4);
  return cycle;
}

const close = (n: number | null) => (n == null ? n : Math.round(n * 1000));

describe("cycleProgress", () => {
  it("counts requests by relationship × department × manager (as of the snapshot)", async () => {
    const { cycle } = await h1();
    const r = await cycleProgress(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(r.status).toBe("calibration");
    expect(
      r.rows.map((x) => [
        x.relationship,
        x.department,
        x.managerName,
        x.total,
        x.submitted,
        x.draft,
      ]),
    ).toEqual([
      ["self", "Ingeniería", "Ana García", 1, 0, 1],
      ["self", "Ingeniería", "Carla Romero", 1, 1, 0],
      ["manager", "Ingeniería", "Ana García", 1, 1, 0],
      ["manager", "Ingeniería", "Carla Romero", 1, 1, 0],
    ]);
    expect(r.totals).toEqual([
      { relationship: "self", total: 2, submitted: 1, draft: 1, declined: 0 },
      {
        relationship: "manager",
        total: 2,
        submitted: 2,
        draft: 0,
        declined: 0,
      },
    ]);
  });

  it("current hierarchy regroups Bruno under Ana (Carla has left)", async () => {
    const { cycle } = await h1();
    const r = await cycleProgress(db, hr, {
      cycleId: cycle.id,
      hierarchy: "current",
    });
    expect(
      r.rows.map((x) => [x.relationship, x.managerName, x.total, x.submitted]),
    ).toEqual([
      ["self", "Ana García", 1, 1],
      ["self", null, 1, 0],
      ["manager", "Ana García", 1, 1],
      ["manager", null, 1, 1],
    ]);
  });

  it("filters by location and hides managers with aggregateOnly", async () => {
    const { cycle } = await h1();
    const r = await cycleProgress(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
      location: "Rosario",
    });
    expect(r.rows.map((x) => [x.relationship, x.total])).toEqual([
      ["self", 1],
      ["manager", 1],
    ]);
    const agg = await cycleProgress(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
      aggregateOnly: true,
    });
    expect(
      agg.rows.every((x) => x.managerId === null && x.managerName === null),
    ).toBe(true);
    expect(agg.rows.map((x) => [x.relationship, x.total])).toEqual([
      ["self", 2],
      ["manager", 2],
    ]);
  });

  it("a manager sees only their direct reports; employees are forbidden", async () => {
    const { cycle } = await h1();
    const asOf = await cycleProgress(db, as(carla, "manager"), {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(asOf.totals.map((t) => [t.relationship, t.total])).toEqual([
      ["self", 1],
      ["manager", 1],
    ]);
    const now = await cycleProgress(db, as(carla, "manager"), {
      cycleId: cycle.id,
      hierarchy: "current",
    });
    expect(now.rows).toEqual([]);
    // Ana: at the snapshot she managed Carla only (Bruno was Carla's report);
    // today she manages Bruno only (Carla has left).
    const anaAsOf = await cycleProgress(db, as(ana, "manager"), {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(
      anaAsOf.rows.map((x) => [x.relationship, x.managerName, x.submitted]),
    ).toEqual([
      ["self", "Ana García", 0],
      ["manager", "Ana García", 1],
    ]);
    const anaNow = await cycleProgress(db, as(ana, "manager"), {
      cycleId: cycle.id,
      hierarchy: "current",
    });
    expect(
      anaNow.rows.map((x) => [x.relationship, x.managerName, x.submitted]),
    ).toEqual([
      ["self", "Ana García", 1],
      ["manager", "Ana García", 1],
    ]);
    await expect(
      cycleProgress(db, as(bruno), { cycleId: cycle.id, hierarchy: "asOf" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("ratingDistribution", () => {
  it("bins normalized ratings pre (manager) and post (current) calibration", async () => {
    const { cycle } = await h1();
    const pre = await ratingDistribution(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
      groupBy: "department",
      stage: "manager",
    });
    expect(pre.bins).toHaveLength(5);
    expect(pre.series).toEqual([
      expect.objectContaining({
        key: "Ingeniería",
        counts: [0, 1, 0, 0, 1],
        n: 2,
      }),
    ]);
    expect(close(pre.series[0].mean)).toBe(close((1 / 3 + 1) / 2));
    const post = await ratingDistribution(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
      groupBy: "department",
      stage: "current",
    });
    expect(post.series[0].counts).toEqual([0, 0, 0, 1, 1]);
    expect(post.total).toEqual([0, 0, 0, 1, 1]);
  });

  it("groups by manager as of the snapshot or now, and by location / title", async () => {
    const { cycle } = await h1();
    const args = { cycleId: cycle.id, stage: "current" as const };
    const asOf = await ratingDistribution(db, hr, {
      ...args,
      hierarchy: "asOf",
      groupBy: "manager",
    });
    expect(asOf.series.map((s) => [s.label, s.counts])).toEqual([
      ["Ana García", [0, 0, 0, 0, 1]],
      ["Carla Romero", [0, 0, 0, 1, 0]],
    ]);
    const now = await ratingDistribution(db, hr, {
      ...args,
      hierarchy: "current",
      groupBy: "manager",
    });
    expect(now.series.map((s) => [s.label, s.counts])).toEqual([
      ["Ana García", [0, 0, 0, 1, 0]],
      [null, [0, 0, 0, 0, 1]],
    ]);
    const loc = await ratingDistribution(db, hr, {
      ...args,
      hierarchy: "asOf",
      groupBy: "location",
    });
    expect(loc.series.map((s) => [s.label, s.counts])).toEqual([
      ["Córdoba", [0, 0, 0, 0, 1]],
      ["Rosario", [0, 0, 0, 1, 0]],
    ]);
    const title = await ratingDistribution(db, hr, {
      ...args,
      hierarchy: "current",
      groupBy: "jobTitle",
    });
    expect(title.series.map((s) => s.label)).toEqual([
      "Senior Developer",
      null,
    ]);
  });

  it("compares cycles with different scales through the normalized value", async () => {
    await h1();
    await h2024();
    // Every cycle: Bruno 2/3 (calibrated), Carla 1, Bruno 2024 1.
    const all = await ratingDistribution(db, hr, {
      hierarchy: "asOf",
      groupBy: "department",
      stage: "current",
    });
    expect(all.total).toEqual([0, 0, 0, 1, 2]);
  });

  it("aggregateOnly drops the manager grouping", async () => {
    const { cycle } = await h1();
    const r = await ratingDistribution(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
      groupBy: "manager",
      stage: "current",
      aggregateOnly: true,
    });
    expect(r.series.map((s) => [s.key, s.label, s.counts])).toEqual([
      [null, null, [0, 0, 0, 1, 1]],
    ]);
  });
});

describe("goalsVsRating", () => {
  it("joins the goal snapshot of the period with the final rating", async () => {
    const { cycle, pb } = await h1();
    await db.insert(participantGoalSnapshot).values([
      {
        participantId: pb,
        goalSourceKey: "native:a",
        title: "A",
        status: "completed",
        percentComplete: 100,
      },
      {
        participantId: pb,
        goalSourceKey: "native:b",
        title: "B",
        status: "in_progress",
        percentComplete: 50,
      },
    ]);
    const r = await goalsVsRating(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(
      r.rows.map((x) => [
        x.name,
        x.goals,
        x.completed,
        x.avgProgress,
        close(x.normalized),
      ]),
    ).toEqual([
      ["Bruno Pérez", 2, 1, 75, close(2 / 3)],
      ["Carla Romero", 0, 0, null, close(1)],
    ]);
  });
});

describe("selfManagerGap", () => {
  it("manager minus self per question and per person (both submitted)", async () => {
    const { cycle } = await h1();
    const r = await selfManagerGap(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(
      r.byQuestion.map((q) => [
        q.prompt.es,
        q.n,
        close(q.meanSelf),
        close(q.meanManager),
        close(q.meanGap),
      ]),
    ).toEqual([["Colaboración", 1, 750, 500, -250]]);
    expect(r.byPerson.map((p) => [p.name, p.n, close(p.meanGap)])).toEqual([
      ["Bruno Pérez", 1, -250],
    ]);
  });
});

const direction: ActorContext = { personId: null, role: "direction" };

/**
 * Dora (Ventas, reports to Ana at the snapshot) joins the H1 2022 cycle with
 * a manager review: overall 3 (2/3). With Bruno and Carla (Ingeniería) the
 * cycle has 3 participants and 3 ratings: Ingeniería 2, Ventas 1.
 */
async function h1WithDora() {
  const dora = await insertPerson({ displayName: "Dora Díaz" });
  await insertJob({
    personId: dora,
    validFrom: "2022-01-01",
    managerPersonId: ana,
    department: "Ventas",
    jobTitle: "Vendedora",
    location: "Rosario",
  });
  const cycle = await createTestCycle(
    input({ personIds: [bruno, carla, dora] }),
  );
  await questionIds(cycle.id);
  await managerReview(cycle.id, bruno, carla, 3, 2);
  await managerReview(cycle.id, carla, ana, 5, 4);
  await managerReview(cycle.id, dora, ana, 3, 3);
  return { cycle, dora };
}

describe("executiveSummary", () => {
  it("People see every group, unmasked, and no names or ids", async () => {
    const { cycle } = await h1();
    const r = await executiveSummary(db, hr, { cycleId: cycle.id });
    expect(r.minGroupSize).toBeNull();
    expect(r.participants).toBe(2);
    expect(r.progress).toEqual([
      { relationship: "self", total: 2, submitted: 1 },
      { relationship: "manager", total: 2, submitted: 2 },
    ]);
    expect(r.distribution).toEqual([0, 0, 0, 1, 1]);
    // Ingeniería has 2 people: People still see it (no minimum applies).
    expect(r.byDepartment).toEqual([
      expect.objectContaining({ department: "Ingeniería", n: 2 }),
    ]);
    expect(r.others).toBeNull();
    expect(r.suppressed).toBe(0);
    const json = JSON.stringify(r);
    for (const secret of [ana, bruno, carla, "Bruno", "Carla", "García"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("direction gets nothing but the head count below the minimum group size", async () => {
    const { cycle } = await h1();
    // Default minimum 5: two participants are under it.
    const r = await executiveSummary(db, direction, { cycleId: cycle.id });
    expect(r).toEqual({
      minGroupSize: 5,
      participants: 2,
      progress: [],
      distribution: [0, 0, 0, 0, 0],
      byDepartment: [],
      others: null,
      suppressed: 2,
    });
  });

  it("direction sees the totals and the groups that reach the minimum", async () => {
    const { cycle } = await h1();
    const r = await executiveSummary(db, direction, {
      cycleId: cycle.id,
      minGroupSize: 2,
    });
    expect(r.minGroupSize).toBe(2);
    expect(r.participants).toBe(2);
    expect(r.progress).toHaveLength(2);
    expect(r.distribution).toEqual([0, 0, 0, 1, 1]);
    expect(r.byDepartment.map((d) => [d.department, d.n])).toEqual([
      ["Ingeniería", 2],
    ]);
    expect(r.suppressed).toBe(0);
    const json = JSON.stringify(r);
    for (const secret of [ana, bruno, carla, "Bruno", "Carla", "García"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("direction: groups under the minimum are folded into Otros, or hidden if still under it", async () => {
    const { cycle } = await h1WithDora();
    // Minimum 2: Ingeniería (2) is listed; Ventas (1) alone is under it.
    const two = await executiveSummary(db, direction, {
      cycleId: cycle.id,
      minGroupSize: 2,
    });
    expect(two.participants).toBe(3);
    expect(two.byDepartment.map((d) => [d.department, d.n])).toEqual([
      ["Ingeniería", 2],
    ]);
    expect(two.others).toBeNull();
    expect(two.suppressed).toBe(1);
    // Minimum 3: neither group reaches it, together they do: one "Otros".
    const three = await executiveSummary(db, direction, {
      cycleId: cycle.id,
      minGroupSize: 3,
    });
    expect(three.byDepartment).toEqual([]);
    expect(three.others).toMatchObject({ n: 3 });
    expect(three.others!.counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(three.suppressed).toBe(0);
    // People see both departments.
    const all = await executiveSummary(db, hr, { cycleId: cycle.id });
    expect(all.byDepartment.map((d) => [d.department, d.n])).toEqual([
      ["Ingeniería", 2],
      ["Ventas", 1],
    ]);
  });

  it("takes the minimum from the aggregation.minGroupSize setting", async () => {
    const { cycle } = await h1WithDora();
    expect(
      (await executiveSummary(db, direction, { cycleId: cycle.id }))
        .minGroupSize,
    ).toBe(5);
    await setSetting(db, hr, "aggregation.minGroupSize", 2);
    const r = await executiveSummary(db, direction, { cycleId: cycle.id });
    expect(r.minGroupSize).toBe(2);
    expect(r.byDepartment.map((d) => d.department)).toEqual(["Ingeniería"]);
  });

  it("is forbidden to managers and employees", async () => {
    const { cycle } = await h1();
    const lost: ActorContext = { personId: null, role: "manager" };
    for (const actor of [as(ana, "manager"), as(ana), lost]) {
      await expect(
        executiveSummary(db, actor, { cycleId: cycle.id }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});

describe("manager scope: direct reports of the snapshot", () => {
  it("a skip-level manager does not see the reports of their reports", async () => {
    const { cycle } = await h1WithDora();
    // Ana -> Carla -> Bruno at the snapshot; Dora reports to Ana directly.
    const carlaView = await cycleProgress(db, as(carla, "manager"), {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(carlaView.totals.map((t) => [t.relationship, t.total])).toEqual([
      ["self", 1],
      ["manager", 1],
    ]);
    const anaView = await cycleProgress(db, as(ana, "manager"), {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    // Carla and Dora, not Bruno (Carla's report).
    expect(anaView.totals.map((t) => [t.relationship, t.total])).toEqual([
      ["self", 2],
      ["manager", 2],
    ]);
    const dist = await ratingDistribution(db, as(ana, "manager"), {
      cycleId: cycle.id,
      hierarchy: "asOf",
      groupBy: "manager",
      stage: "current",
    });
    expect(dist.series.map((s) => [s.label, s.n])).toEqual([["Ana García", 2]]);
    const goals = await goalsVsRating(db, as(ana, "manager"), {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(goals.rows.map((r) => r.name)).toEqual([
      "Carla Romero",
      "Dora Díaz",
    ]);
    const options = await dashboardFilterOptions(db, as(carla, "manager"), {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(options.managers).toEqual([{ id: carla, name: "Carla Romero" }]);
  });
});

describe("authorization by role", () => {
  // Carla manages Bruno at the snapshot; Ana as an employee has no part in
  // any of it.
  const actorFor = (name: string): ActorContext =>
    ({
      hr,
      manager: as(carla, "manager"),
      managerWithoutPerson: { personId: null, role: "manager" } as const,
      employee: as(ana),
      direction,
    })[name as "hr"];
  const roleNames = [
    "hr",
    "manager",
    "managerWithoutPerson",
    "employee",
    "direction",
  ];
  type Run = (actor: ActorContext) => Promise<unknown>;
  type Case = { query: string; run: (cycleId: string) => Run };
  const queries: Case[] = [
    {
      query: "cycleProgress",
      run: (cycleId) => (a) =>
        cycleProgress(db, a, { cycleId, hierarchy: "asOf" }),
    },
    {
      query: "ratingDistribution",
      run: (cycleId) => (a) =>
        ratingDistribution(db, a, {
          cycleId,
          hierarchy: "asOf",
          groupBy: "department",
          stage: "current",
        }),
    },
    {
      query: "goalsVsRating",
      run: (cycleId) => (a) =>
        goalsVsRating(db, a, { cycleId, hierarchy: "asOf" }),
    },
    {
      query: "selfManagerGap",
      run: (cycleId) => (a) =>
        selfManagerGap(db, a, { cycleId, hierarchy: "asOf" }),
    },
    {
      query: "dashboardFilterOptions",
      run: (cycleId) => (a) =>
        dashboardFilterOptions(db, a, { cycleId, hierarchy: "asOf" }),
    },
    {
      query: "executiveSummary",
      run: (cycleId) => (a) => executiveSummary(db, a, { cycleId }),
    },
  ];
  const allowed: Record<string, string[]> = {
    hr: queries.map((q) => q.query),
    manager: queries
      .map((q) => q.query)
      .filter((q) => q !== "executiveSummary"),
    managerWithoutPerson: [],
    employee: [],
    direction: ["executiveSummary"],
  };

  it.each(roleNames)("%s", async (name) => {
    const { cycle } = await h1();
    const actor = actorFor(name);
    for (const { query, run } of queries) {
      const outcome = run(cycle.id)(actor);
      if (allowed[name].includes(query)) {
        await expect(outcome, `${name} ${query}`).resolves.toBeDefined();
      } else {
        await expect(outcome, `${name} ${query}`).rejects.toMatchObject({
          code: "forbidden",
        });
      }
    }
  });
});

describe("reassigned manager review", () => {
  it("superseded requests are neither counted nor paired", async () => {
    const { cycle, pb } = await h1();
    // Ana replaced Carla: Carla's submitted review is superseded and Ana
    // has a fresh draft.
    const carlas = await requestIdOf(pb, "manager", carla);
    await db
      .update(reviewRequest)
      .set({ status: "superseded" })
      .where(eq(reviewRequest.id, carlas));
    await db.insert(reviewRequest).values({
      cycleId: cycle.id,
      participantId: pb,
      relationship: "manager",
      reviewerPersonId: ana,
    });
    const r = await cycleProgress(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(r.totals).toEqual([
      { relationship: "self", total: 2, submitted: 1, draft: 1, declined: 0 },
      {
        relationship: "manager",
        total: 2,
        submitted: 1,
        draft: 1,
        declined: 0,
      },
    ]);
    const gap = await selfManagerGap(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(gap.byQuestion).toEqual([]);
    expect(gap.byPerson).toEqual([]);
  });
});

describe("CSV exports", () => {
  const csv = async (file: string, query: string) => {
    const res = await exportCsv(
      db,
      file,
      new Request(`http://x/api/v1/export/${file}?${query}`),
    );
    return (await res.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
  };

  it("exports progress, distribution, goals and gap of a cycle", async () => {
    const { cycle } = await h1();
    expect(await csv("dashboard-progress.csv", `cycle=${cycle.id}`)).toEqual([
      "tipo,área,manager_id,manager,total,enviadas,pendientes,rechazadas",
      `self,Ingeniería,${ana},Ana García,1,0,1,0`,
      `self,Ingeniería,${carla},Carla Romero,1,1,0,0`,
      `manager,Ingeniería,${ana},Ana García,1,1,0,0`,
      `manager,Ingeniería,${carla},Carla Romero,1,1,0,0`,
    ]);
    const dist = await csv(
      "dashboard-distribution.csv",
      `cycle=${cycle.id}&aggregateOnly=true&groupBy=manager&locale=en`,
    );
    expect(dist[0]).toBe("group,from,to,count,people,mean_normalized");
    expect(dist.slice(1).map((l) => l.split(",")[3])).toEqual([
      "0",
      "0",
      "0",
      "1",
      "1",
    ]);
    const goals = await csv(
      "dashboard-goals-vs-rating.csv",
      `cycle=${cycle.id}`,
    );
    expect(goals).toHaveLength(3);
    const gap = await csv(
      "dashboard-self-manager-gap.csv",
      `cycle=${cycle.id}`,
    );
    expect(gap[1]).toContain("Bruno Pérez,1,-0.25");
  });
});

describe("dashboardFilterOptions", () => {
  it("lists the values of the visible participants per hierarchy", async () => {
    const { cycle } = await h1();
    const asOf = await dashboardFilterOptions(db, hr, {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(asOf).toEqual({
      departments: ["Ingeniería"],
      managers: [
        { id: ana, name: "Ana García" },
        { id: carla, name: "Carla Romero" },
      ],
      locations: ["Córdoba", "Rosario"],
      jobTitles: ["Developer", "Engineering Manager"],
      org: { accounts: [], projects: [], dms: [], santexLeads: [] },
    });
    const now = await dashboardFilterOptions(db, as(carla, "manager"), {
      cycleId: cycle.id,
      hierarchy: "current",
    });
    expect(now.managers).toEqual([]);
  });
});
