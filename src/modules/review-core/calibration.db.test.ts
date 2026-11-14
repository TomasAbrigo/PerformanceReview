import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  ratingScale,
  finalRating,
  person,
  reviewAudit,
  reviewCycle,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";
import {
  createCycle,
  findManagerRequestId,
  getReview,
  launchCycle,
  saveDraft,
  shareAll,
  submit,
  transition,
  unlock,
  unshare,
  type CycleInput,
  type Review,
} from ".";
import {
  addCalibrator,
  calibrationTable,
  createGroup,
  currentRatingFor,
  distribution,
  listGroups,
  myPublishedRating,
  proposeRating,
  publishCalibration,
} from "./calibration";

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
  templateId = (await listTemplates(db)).find(
    (t) => t.isSystem && t.enabled,
  )!.id;
});

beforeEach(async () => {
  await reset();
  const dir = await mkdtemp(path.join(tmpdir(), "calibration-"));
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

/** Every question answered; ratings get `rating`. */
const fillAll = (review: Review, rating: number) =>
  review.questions.map((q) => ({
    questionRevisionId: q.id,
    value:
      q.kind === "rating"
        ? rating
        : q.kind === "single_choice"
          ? q.choices![0].value
          : `Respuesta ${q.sort}`,
  }));

async function submitManager(
  cycleId: string,
  reviewee: string,
  manager: string,
  rating: number,
) {
  const p = await participantOf(cycleId, reviewee);
  const id = (await findManagerRequestId(db, as(manager), p.id))!;
  const review = (await getReview(db, as(manager), id))!;
  await saveDraft(db, as(manager), id, fillAll(review, rating));
  await submit(db, as(manager), id);
  return { participantId: p.id, requestId: id };
}

/** Publishes, moves to sharing (sharing waits for publish) and shares all. */
async function publishAndShare(cycleId: string) {
  await publishCalibration(db, hr, cycleId);
  await transition(db, cycleId, "sharing", null);
  await shareAll(db, hr, cycleId);
}

/** Cycle in calibration; Carla rated Bruno 2 and Ana rated Carla 3. */
async function ratedCycle(overrides: Partial<CycleInput> = {}) {
  const cycle = await createCycle(db, input(overrides));
  await launchCycle(db, cycle.id, null);
  const b = await submitManager(cycle.id, bruno, carla, 2);
  const c = await submitManager(cycle.id, carla, ana, 3);
  await transition(db, cycle.id, "manager_review", null);
  await transition(db, cycle.id, "calibration", null);
  return { cycle, b, c };
}

const rows = (participantId: string) =>
  db
    .select()
    .from(finalRating)
    .where(eq(finalRating.participantId, participantId))
    .orderBy(finalRating.createdAt);

describe("final_rating log", () => {
  it("submitting the manager review writes a manager-stage row", async () => {
    const { b } = await ratedCycle();
    const log = await rows(b.participantId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ stage: "manager", optionValue: 2 });
    expect(log[0].actorPersonId).toBe(carla);
    expect((await currentRatingFor(db, b.participantId))?.optionValue).toBe(2);
  });

  it("rejects a proposal without reason", async () => {
    const { b } = await ratedCycle();
    await expect(
      proposeRating(db, hr, b.participantId, { value: 3, reason: "  " }),
    ).rejects.toMatchObject({ code: "reason_required" });
    expect(await rows(b.participantId)).toHaveLength(1);
  });

  it("rejects a value outside the final scale", async () => {
    const { b } = await ratedCycle();
    await expect(
      proposeRating(db, hr, b.participantId, { value: 9, reason: "x" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("each proposal appends a row and never mutates prior rows", async () => {
    const { b } = await ratedCycle();
    const before = await rows(b.participantId);
    await proposeRating(db, hr, b.participantId, {
      value: 3,
      reason: "Impacto",
      flag: true,
    });
    await proposeRating(db, hr, b.participantId, { value: 4, reason: "Más" });
    const after = await rows(b.participantId);
    expect(after).toHaveLength(3);
    expect(after[0]).toEqual(before[0]);
    expect(after.slice(1).map((r) => [r.stage, r.optionValue])).toEqual([
      ["calibrated", 3],
      ["calibrated", 4],
    ]);
    expect(after[1].reason).toBe("Impacto");
    expect(after[1].flagged).toBe(true);
  });
});

describe("v_current_rating", () => {
  it("applies override > calibrated > manager > computed, latest within stage", async () => {
    const { b } = await ratedCycle();
    const pid = b.participantId;
    const add = (stage: "computed" | "override" | "calibrated", v: number) =>
      db.insert(finalRating).values({
        participantId: pid,
        stage,
        optionValue: v,
        reason: "t",
        createdAt: new Date(Date.now() + 60_000),
      });
    await add("computed", 1); // newer, but lowest precedence
    expect((await currentRatingFor(db, pid))?.stage).toBe("manager");
    await proposeRating(db, hr, pid, { value: 3, reason: "a" });
    await proposeRating(db, hr, pid, { value: 4, reason: "b" });
    expect(await currentRatingFor(db, pid)).toMatchObject({
      stage: "calibrated",
      optionValue: 4,
    });
    await add("override", 1);
    expect(await currentRatingFor(db, pid)).toMatchObject({
      stage: "override",
      optionValue: 1,
    });
  });
});

describe("groups and table", () => {
  it("creates groups by department, by manager or manually", async () => {
    const { cycle, b, c } = await ratedCycle();
    const pb = await participantOf(cycle.id, bruno);
    const byDept = await createGroup(db, hr, cycle.id, {
      name: "Dept",
      kind: "by_department",
      department: pb.snapDepartment!,
    });
    const byManager = await createGroup(db, hr, cycle.id, {
      name: "Carla",
      kind: "by_manager",
      managerPersonId: carla,
    });
    const manual = await createGroup(db, hr, cycle.id, {
      name: "Manual",
      kind: "manual",
      participantIds: [b.participantId, c.participantId],
    });
    const ids = async (g: string) =>
      (await calibrationTable(db, hr, g)).rows.map((r) => r.participantId);
    expect(await ids(byDept.id)).toContain(b.participantId);
    expect(await ids(byManager.id)).toEqual([b.participantId]);
    expect((await ids(manual.id)).sort()).toEqual(
      [b.participantId, c.participantId].sort(),
    );
    await expect(
      createGroup(db, as(carla, "manager"), cycle.id, {
        name: "x",
        kind: "manual",
        participantIds: [],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("table shows original manager rating, current rating and reason history", async () => {
    const { cycle, b } = await ratedCycle();
    const g = await createGroup(db, hr, cycle.id, {
      name: "Carla",
      kind: "by_manager",
      managerPersonId: carla,
    });
    await proposeRating(db, hr, b.participantId, {
      value: 3,
      reason: "Impacto",
      flag: true,
    });
    const table = await calibrationTable(db, hr, g.id);
    expect(table.canEdit).toBe(true);
    expect(table.scale.map((o) => o.value)).toEqual([1, 2, 3, 4]);
    expect(table.rows[0]).toMatchObject({
      revieweeName: "Bruno Pérez",
      managerName: "Carla Romero",
      managerRating: { value: 2 },
      currentRating: { value: 3, stage: "calibrated" },
      flagged: true,
    });
    expect(table.rows[0].history.map((h) => h.reason)).toEqual(["Impacto"]);
  });

  it("calibrators read their groups but cannot write", async () => {
    const { cycle, b } = await ratedCycle();
    const g = await createGroup(db, hr, cycle.id, {
      name: "Carla",
      kind: "by_manager",
      managerPersonId: carla,
    });
    await expect(calibrationTable(db, as(ana), g.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await addCalibrator(db, hr, g.id, ana);
    expect(await listGroups(db, as(ana), cycle.id)).toHaveLength(1);
    const table = await calibrationTable(db, as(ana), g.id);
    expect(table.canEdit).toBe(false);
    expect(table.rows).toHaveLength(1);
    await expect(
      proposeRating(db, as(ana, "calibrator"), b.participantId, {
        value: 3,
        reason: "x",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await rows(b.participantId)).toHaveLength(1);
  });
});

describe("distribution", () => {
  it("counts per group and option; pre (manager) vs post (current)", async () => {
    const { cycle, b } = await ratedCycle();
    await proposeRating(db, hr, b.participantId, { value: 4, reason: "x" });
    const pre = await distribution(db, hr, cycle.id, {
      groupBy: "manager",
      stage: "manager",
    });
    const post = await distribution(db, hr, cycle.id, {
      groupBy: "manager",
      stage: "current",
    });
    const total = (d: typeof pre) =>
      d.series.reduce((n, s) => n + s.counts.reduce((a, c) => a + c, 0), 0);
    expect(pre.options.map((o) => o.value)).toEqual([1, 2, 3, 4]);
    expect(total(pre)).toBe(2);
    expect(total(post)).toBe(2);
    const carlas = (d: typeof pre) =>
      d.series.find((s) => s.key === carla)!.counts;
    expect(carlas(pre)).toEqual([0, 1, 0, 0]);
    expect(carlas(post)).toEqual([0, 0, 0, 1]);
    const byDept = await distribution(db, hr, cycle.id, {
      groupBy: "department",
      stage: "current",
    });
    expect(total(byDept)).toBe(2);
  });

  it("distribution counts equal the table rows", async () => {
    const { cycle } = await ratedCycle();
    const g = await createGroup(db, hr, cycle.id, {
      name: "All",
      kind: "manual",
      participantIds: (
        await db
          .select({ id: cycleParticipant.id })
          .from(cycleParticipant)
          .where(eq(cycleParticipant.cycleId, cycle.id))
      ).map((r) => r.id),
    });
    const table = await calibrationTable(db, hr, g.id);
    const d = await distribution(db, hr, cycle.id, {
      groupBy: "department",
      stage: "current",
    });
    const total = d.series.reduce(
      (n, s) => n + s.counts.reduce((a, c) => a + c, 0),
      0,
    );
    expect(total).toBe(table.rows.filter((r) => r.currentRating).length);
  });
});

describe("publish and employee visibility", () => {
  it("publish audits every participant once and sets published_at", async () => {
    const { cycle, b, c } = await ratedCycle();
    await expect(
      publishCalibration(db, as(carla, "manager"), cycle.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await publishCalibration(db, hr, cycle.id)).toBe(2);
    expect(await publishCalibration(db, hr, cycle.id)).toBe(0); // idempotent
    const [row] = await db
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.id, cycle.id));
    expect(row.calibrationPublishedAt).not.toBeNull();
    const audit = await db
      .select()
      .from(reviewAudit)
      .where(eq(reviewAudit.action, "calibration_published"));
    expect(audit.map((a) => a.requestId).sort()).toEqual(
      [b.requestId, c.requestId].sort(),
    );
  });

  it("the employee sees only the current rating after share + publish", async () => {
    const { cycle, b } = await ratedCycle();
    await proposeRating(db, hr, b.participantId, {
      value: 4,
      reason: "secreto",
    });
    expect(await myPublishedRating(db, as(bruno), cycle.id)).toBeNull();
    await publishCalibration(db, hr, cycle.id);
    expect(await myPublishedRating(db, as(bruno), cycle.id)).toBeNull();
    await transition(db, cycle.id, "sharing", null);
    await shareAll(db, hr, cycle.id);
    const mine = await myPublishedRating(db, as(bruno), cycle.id);
    expect(mine).toEqual({
      value: 4,
      label: { es: "Marca un nuevo estándar", en: "Sets a new standard" },
    });
    expect(JSON.stringify(mine)).not.toContain("secreto");
  });

  it("editing a shared manager review requires unshare first", async () => {
    const { cycle, b } = await ratedCycle();
    await publishAndShare(cycle.id);
    await transition(db, cycle.id, "calibration", null);
    await transition(db, cycle.id, "manager_review", null);
    await unlock(db, hr, b.requestId, null);
    const review = (await getReview(db, as(carla), b.requestId))!;
    await expect(
      saveDraft(db, as(carla), b.requestId, fillAll(review, 3)),
    ).rejects.toMatchObject({ code: "shared" });
    await unshare(db, hr, b.requestId);
    await saveDraft(db, as(carla), b.requestId, fillAll(review, 3));
    await submit(db, as(carla), b.requestId);
    expect((await currentRatingFor(db, b.participantId))?.optionValue).toBe(3);
  });
});

describe("review findings", () => {
  it("validates group criteria; manual without ids takes every active participant", async () => {
    const { cycle } = await ratedCycle();
    await expect(
      createGroup(db, hr, cycle.id, {
        name: "x",
        kind: "by_manager",
        managerPersonId: "nope",
      }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      createGroup(db, hr, cycle.id, {
        name: "x",
        kind: "by_department",
        department: " ",
      }),
    ).rejects.toMatchObject({ code: "validation" });
    const all = await createGroup(db, hr, cycle.id, {
      name: "Todos",
      kind: "manual",
    });
    expect((await calibrationTable(db, hr, all.id)).rows).toHaveLength(2);
  });

  it("after publish, changes are audited overrides with a required reason", async () => {
    const { cycle, b } = await ratedCycle();
    await publishAndShare(cycle.id);
    await expect(
      proposeRating(db, hr, b.participantId, { value: 3, reason: "" }),
    ).rejects.toMatchObject({ code: "reason_required" });
    await proposeRating(db, hr, b.participantId, { value: 3, reason: "Error" });
    const log = await rows(b.participantId);
    expect(log.at(-1)).toMatchObject({ stage: "override", optionValue: 3 });
    const audit = await db
      .select()
      .from(reviewAudit)
      .where(eq(reviewAudit.action, "rating_override"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ requestId: b.requestId, note: "Error" });
    expect((await myPublishedRating(db, as(bruno), cycle.id))?.value).toBe(3);
  });

  it("scopes the distribution to the calibrator's groups", async () => {
    const { cycle } = await ratedCycle();
    await expect(
      distribution(db, as(ana, "calibrator"), cycle.id, {
        groupBy: "manager",
        stage: "current",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const g = await createGroup(db, hr, cycle.id, {
      name: "Carla",
      kind: "by_manager",
      managerPersonId: carla,
    });
    await addCalibrator(db, hr, g.id, ana);
    const d = await distribution(db, as(ana, "calibrator"), cycle.id, {
      groupBy: "manager",
      stage: "current",
    });
    expect(d.series.map((s) => s.key)).toEqual([carla]);
    expect(d.series[0].counts.reduce((a, c) => a + c, 0)).toBe(1);
  });

  it("a calibrator with read_only=false may propose in their group", async () => {
    const { cycle, b, c } = await ratedCycle();
    const g = await createGroup(db, hr, cycle.id, {
      name: "Carla",
      kind: "by_manager",
      managerPersonId: carla,
    });
    await addCalibrator(db, hr, g.id, ana, { readOnly: false });
    expect((await calibrationTable(db, as(ana), g.id)).canEdit).toBe(true);
    await proposeRating(db, as(ana, "calibrator"), b.participantId, {
      value: 3,
      reason: "ok",
    });
    await expect(
      proposeRating(db, as(ana, "calibrator"), c.participantId, {
        value: 3,
        reason: "fuera del grupo",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("maps the original rating to a differing final scale by normalized value", async () => {
    const [five] = await db
      .select({ id: ratingScale.id })
      .from(ratingScale)
      .where(eq(ratingScale.systemKey, "five_point_agreement"));
    // Manager answers 2 on the 4-point scale (normalized 1/3).
    const { cycle, b } = await ratedCycle({ finalScaleId: five.id });
    const g = await createGroup(db, hr, cycle.id, {
      name: "Carla",
      kind: "by_manager",
      managerPersonId: carla,
    });
    const [row] = (await calibrationTable(db, hr, g.id)).rows;
    expect(row.participantId).toBe(b.participantId);
    // Label as the manager chose it, not the 5-point option with value 2.
    expect(row.managerRating?.label?.es).toBe("Cumple expectativas");
    const d = await distribution(db, hr, cycle.id, {
      groupBy: "manager",
      stage: "manager",
    });
    // Nearest normalized option of the 5-point scale: 0.25 (value 2).
    expect(d.series.find((s) => s.key === carla)!.counts).toEqual([
      0, 1, 0, 0, 0,
    ]);
  });

  it("v_current_rating exists with the expected columns", async () => {
    const cols = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'v_current_rating' order by ordinal_position`,
    );
    expect(cols.map((c) => c.column_name)).toEqual([
      "id",
      "participant_id",
      "stage",
      "option_value",
      "option_label",
      "normalized",
      "actor_person_id",
      "reason",
      "flagged",
      "created_at",
    ]);
  });
});
