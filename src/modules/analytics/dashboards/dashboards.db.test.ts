import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { cycleParticipant, participantGoalSnapshot, person } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import {
  createCycle,
  findManagerRequestId,
  findMySelfRequestId,
  launchCycle,
  proposeRating,
  saveDraft,
  submit,
  transition,
  type CycleInput,
} from "@/modules/review-core";
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
  executiveSummary,
  goalsVsRating,
  managerTeam,
  personTrajectory,
  ratingDistribution,
  selfManagerGap,
} from ".";

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
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
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

const input = (overrides: Partial<CycleInput> = {}): CycleInput => ({
  name: "H1 2022",
  periodStart: "2022-01-01",
  periodEnd: "2022-06-30",
  snapshotDate: "2022-06-01",
  components: {
    self: true,
    manager: true,
    peer: false,
    upward: false,
    calibration: true,
  },
  anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
  templateId,
  dueDates: {},
  participantFilter: { kind: "people", personIds: [bruno, carla] },
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

async function selfReview(
  cycleId: string,
  who: string,
  value: number,
  done: boolean,
) {
  const id = (await findMySelfRequestId(db, as(who), cycleId))!;
  await saveDraft(db, as(who), id, [{ questionRevisionId: q1, value }]);
  if (done) await submit(db, as(who), id);
}

async function managerReview(
  cycleId: string,
  reviewee: string,
  manager: string,
  value: number,
  rating: number,
) {
  const p = await participantOf(cycleId, reviewee);
  const id = (await findManagerRequestId(db, as(manager), p.id))!;
  await saveDraft(db, as(manager), id, [
    { questionRevisionId: q1, value },
    { questionRevisionId: overall, value: rating },
  ]);
  await submit(db, as(manager), id);
  return p.id;
}

/**
 * H1 2022: Bruno self Q1=4 (0.75, submitted); Carla self Q1=2 (draft);
 * Carla rates Bruno Q1=3 (0.5), overall 2 (1/3); Ana rates Carla Q1=5,
 * overall 4 (1). HR calibrates Bruno to 3 (2/3).
 */
async function h1() {
  const cycle = await createCycle(db, input());
  await launchCycle(db, cycle.id, null);
  await questionIds(cycle.id);
  await selfReview(cycle.id, bruno, 4, true);
  await selfReview(cycle.id, carla, 2, false);
  const pb = await managerReview(cycle.id, bruno, carla, 3, 2);
  const pc = await managerReview(cycle.id, carla, ana, 5, 4);
  await transition(db, cycle.id, "manager_review", null);
  await transition(db, cycle.id, "calibration", null);
  await proposeRating(db, hr, pb, { value: 3, reason: "Impacto" });
  return { cycle, pb, pc };
}

/** H1 2024 (snapshot 2024-02-01): only Bruno; Ana rates overall 4 (1). */
async function h2024() {
  const cycle = await createCycle(
    db,
    input({
      name: "H1 2024",
      periodStart: "2024-01-01",
      periodEnd: "2024-06-30",
      snapshotDate: "2024-02-01",
      participantFilter: { kind: "people", personIds: [bruno] },
    }),
  );
  await launchCycle(db, cycle.id, null);
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

  it("a manager sees only their team; employees are forbidden", async () => {
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

describe("personTrajectory", () => {
  it("lists each cycle with the normalized rating, manager and title of the moment", async () => {
    const { cycle } = await h1();
    const c2 = await h2024();
    const t = await personTrajectory(db, hr, bruno);
    expect(t.personName).toBe("Bruno Pérez");
    expect(
      t.points.map((p) => [
        p.cycleId,
        close(p.normalized),
        p.stage,
        p.managerName,
        p.jobTitle,
      ]),
    ).toEqual([
      [cycle.id, close(2 / 3), "calibrated", "Carla Romero", "Developer"],
      [c2.id, close(1), "manager", "Ana García", "Senior Developer"],
    ]);
  });

  it("applies visibility: own (published only), manager by team, others forbidden", async () => {
    const { cycle } = await h1();
    const c2 = await h2024();
    const own = await personTrajectory(db, as(bruno), bruno);
    expect(own.points.map((p) => p.normalized)).toEqual([null, null]);
    const carlaView = await personTrajectory(db, as(carla, "manager"), bruno);
    expect(carlaView.points.map((p) => p.cycleId)).toEqual([cycle.id]);
    const anaView = await personTrajectory(db, as(ana, "manager"), bruno);
    expect(anaView.points.map((p) => p.cycleId)).toEqual([cycle.id, c2.id]);
    await expect(personTrajectory(db, as(carla), bruno)).rejects.toMatchObject(
      { code: "forbidden" },
    );
  });
});

describe("managerTeam", () => {
  it("as-of vs current changes the subtree (recursive)", async () => {
    const { cycle } = await h1();
    const asOf = await managerTeam(db, hr, {
      managerId: carla,
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(
      asOf.members.map((m) => [m.name, m.depth, close(m.normalized)]),
    ).toEqual([["Bruno Pérez", 1, close(2 / 3)]]);
    const now = await managerTeam(db, hr, {
      managerId: carla,
      cycleId: cycle.id,
      hierarchy: "current",
    });
    expect(now.members).toEqual([]);
    const ana1 = await managerTeam(db, hr, {
      managerId: ana,
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(ana1.members.map((m) => [m.name, m.depth])).toEqual([
      ["Carla Romero", 1],
      ["Bruno Pérez", 2],
    ]);
    const ana2 = await managerTeam(db, hr, {
      managerId: ana,
      cycleId: cycle.id,
      hierarchy: "current",
    });
    expect(ana2.members.map((m) => [m.name, m.depth])).toEqual([
      ["Bruno Pérez", 1],
    ]);
  });

  it("a manager can only open their own team", async () => {
    const { cycle } = await h1();
    await expect(
      managerTeam(db, as(carla, "manager"), {
        managerId: ana,
        cycleId: cycle.id,
        hierarchy: "asOf",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const own = await managerTeam(db, as(carla, "manager"), {
      cycleId: cycle.id,
      hierarchy: "asOf",
    });
    expect(own.members.map((m) => m.name)).toEqual(["Bruno Pérez"]);
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

describe("executiveSummary", () => {
  it("aggregates without names or ids and suppresses small groups", async () => {
    const { cycle } = await h1();
    const r = await executiveSummary(db, hr, { cycleId: cycle.id });
    expect(r.participants).toBe(2);
    expect(r.progress).toEqual([
      { relationship: "self", total: 2, submitted: 1 },
      { relationship: "manager", total: 2, submitted: 2 },
    ]);
    expect(r.distribution).toEqual([0, 0, 0, 1, 1]);
    // Ingeniería has 2 people (< MIN_GROUP 3): folded into "suppressed".
    expect(r.byDepartment).toEqual([]);
    expect(r.suppressed).toBe(2);
    const json = JSON.stringify(r);
    for (const secret of [ana, bruno, carla, "Bruno", "Carla", "García"]) {
      expect(json).not.toContain(secret);
    }
    await expect(
      executiveSummary(db, as(ana, "manager"), { cycleId: cycle.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
