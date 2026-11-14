import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  person,
  questionRevision,
  reviewAudit,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";
import {
  addParticipant,
  createCycle,
  findManagerRequestId,
  findMySelfRequestId,
  findMySharedReviewId,
  getReview,
  isSkipLevel,
  launchCycle,
  listMyTasks,
  listTeam,
  removeParticipant,
  ReviewError,
  saveDraft,
  sendReminder,
  shareAll,
  shareReview,
  submit,
  transition,
  unshare,
  type CycleInput,
  type Review,
} from ".";

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
  const dir = await mkdtemp(path.join(tmpdir(), "manager-"));
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
      peer: true,
      upward: false,
      calibration: false,
    },
    anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
    templateId,
    dueDates: { self: "2022-07-15", manager: "2022-07-30" },
    participantFilter: { kind: "people", personIds: [ana, bruno] },
    ...overrides,
  };
}

const managerRequests = (cycleId: string) =>
  db
    .select()
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        eq(reviewRequest.relationship, "manager"),
      ),
    );

async function collectingCycle(overrides: Partial<CycleInput> = {}) {
  const cycle = await createCycle(db, input(overrides));
  await launchCycle(db, cycle.id, null);
  await transition(db, cycle.id, "collecting", null);
  return cycle;
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

/** Valid answers for every question of a review. */
const fillAll = (review: Review) =>
  review.questions.map((q) => ({
    questionRevisionId: q.id,
    value:
      q.kind === "rating"
        ? q.scale!.options[0].value
        : q.kind === "single_choice"
          ? q.choices![0].value
          : `Respuesta ${q.sort}`,
  }));

/** Carla fills and submits her manager review of Bruno. */
async function submitManagerReview(cycleId: string) {
  const p = await participantOf(cycleId, bruno);
  const id = (await findManagerRequestId(db, as(carla), p.id))!;
  const review = (await getReview(db, as(carla), id))!;
  await saveDraft(db, as(carla), id, fillAll(review));
  await submit(db, as(carla), id);
  return id;
}

/** Bruno fills and submits his self review. */
async function submitSelf(cycleId: string) {
  const id = (await findMySelfRequestId(db, as(bruno), cycleId))!;
  const review = (await getReview(db, as(bruno), id))!;
  await saveDraft(db, as(bruno), id, fillAll(review));
  await submit(db, as(bruno), id);
  return id;
}

describe("manager requests", () => {
  it("creates one manager request per participant on entering collecting", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    expect(await managerRequests(cycle.id)).toHaveLength(0); // nominations
    await transition(db, cycle.id, "collecting", null);
    const rows = await managerRequests(cycle.id);
    expect(rows).toHaveLength(2);
    const brunos = await participantOf(cycle.id, bruno);
    const forBruno = rows.find((r) => r.participantId === brunos.id)!;
    expect(forBruno.reviewerPersonId).toBe(carla);
    expect(forBruno.reviewerMissing).toBe(false);
  });

  it("flags reviewer_missing when the participant had no manager", async () => {
    const cycle = await collectingCycle();
    const anas = await participantOf(cycle.id, ana);
    const [row] = (await managerRequests(cycle.id)).filter(
      (r) => r.participantId === anas.id,
    );
    expect(row.reviewerPersonId).toBeNull();
    expect(row.reviewerMissing).toBe(true);
  });

  it("is idempotent (re-entering collecting, also with a missing reviewer)", async () => {
    const cycle = await collectingCycle();
    await transition(db, cycle.id, "nominations", null);
    await transition(db, cycle.id, "collecting", null);
    expect(await managerRequests(cycle.id)).toHaveLength(2);
  });

  it("creates none when the manager component is off", async () => {
    const cycle = await collectingCycle({
      components: {
        self: true,
        manager: false,
        peer: true,
        upward: false,
        calibration: false,
      },
    });
    expect(await managerRequests(cycle.id)).toHaveLength(0);
  });

  it("creates one for a participant added mid-cycle", async () => {
    const cycle = await collectingCycle();
    await addParticipant(db, cycle.id, carla, "2022-06-01");
    const rows = await managerRequests(cycle.id);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.reviewerPersonId === ana)).toHaveLength(1);
  });

  it("lets the manager write their review with the manager questions", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const id = (await findManagerRequestId(db, as(carla), p.id))!;
    const review = (await getReview(db, as(carla), id))!;
    expect(review.canWrite).toBe(true);
    expect(review.questions.length).toBeGreaterThan(0);
    expect(review.questions.every((q) => q.appliesTo.includes("manager"))).toBe(
      true,
    );
    expect(review.cycle.dueDate).toBe("2022-07-30");
    expect(await findManagerRequestId(db, as(bruno), p.id)).toBeNull();
  });
});

describe("double blind", () => {
  it("hides the self review from the manager until they submit theirs", async () => {
    const cycle = await collectingCycle();
    const selfId = await submitSelf(cycle.id);
    expect(await getReview(db, as(carla, "manager"), selfId)).toBeNull();
    await submitManagerReview(cycle.id);
    const seen = await getReview(db, as(carla, "manager"), selfId);
    expect(seen?.request.status).toBe("submitted");
    expect(seen?.canWrite).toBe(false);
  });

  it("without double blind the manager reads a submitted self anytime", async () => {
    const cycle = await collectingCycle({
      components: {
        self: true,
        manager: true,
        peer: true,
        upward: false,
        calibration: false,
        doubleBlind: false,
      },
    });
    const selfId = (await findMySelfRequestId(db, as(bruno), cycle.id))!;
    expect(await getReview(db, as(carla), selfId)).toBeNull(); // draft
    await submitSelf(cycle.id);
    expect(await getReview(db, as(carla), selfId)).not.toBeNull();
  });

  it("stores doubleBlind on by default", async () => {
    const cycle = await collectingCycle();
    const [row] = await db
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.id, cycle.id));
    expect(row.components.doubleBlind ?? true).toBe(true);
  });
});

/** Moves a collecting cycle (no calibration) to sharing. */
async function toSharing(cycleId: string) {
  await transition(db, cycleId, "manager_review", null);
  await transition(db, cycleId, "sharing", null);
}

describe("sharing", () => {
  it("shows the employee nothing before sharing, only visible questions after", async () => {
    const cycle = await collectingCycle();
    const id = await submitManagerReview(cycle.id);
    const [hidden] = await db
      .update(questionRevision)
      .set({ visibleToReviewee: false })
      .where(
        and(
          eq(questionRevision.cycleId, cycle.id),
          sql`'manager' = ANY(${questionRevision.appliesTo})`,
          eq(questionRevision.kind, "text"),
        ),
      )
      .returning();
    await toSharing(cycle.id);

    expect(await getReview(db, as(bruno), id)).toBeNull();
    expect(await findMySharedReviewId(db, as(bruno), cycle.id)).toBeNull();

    await shareReview(db, as(carla, "manager"), id);
    expect(await findMySharedReviewId(db, as(bruno), cycle.id)).toBe(id);
    const seen = (await getReview(db, as(bruno), id))!;
    expect(seen.canWrite).toBe(false);
    expect(seen.questions.length).toBeGreaterThan(0);
    expect(seen.questions.every((q) => q.visibleToReviewee)).toBe(true);
    expect(seen.questions.some((q) => q.id === hidden.id)).toBe(false);
    expect(Object.keys(seen.answers)).not.toContain(hidden.id);

    const tasks = await listMyTasks(db, as(bruno));
    expect(tasks.sharedReviews.map((t) => t.requestId)).toEqual([id]);

    const audit = await db
      .select()
      .from(reviewAudit)
      .where(eq(reviewAudit.requestId, id));
    expect(audit.map((a) => a.action)).toEqual(["shared"]);
    expect(audit[0].actorPersonId).toBe(carla);
  });

  it("refuses sharing a draft or by someone who is not the manager/HR", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const id = (await findManagerRequestId(db, as(carla), p.id))!;
    await transition(db, cycle.id, "manager_review", null);
    await transition(db, cycle.id, "sharing", null);
    await expect(shareReview(db, as(carla), id)).rejects.toMatchObject({
      code: "not_submitted",
    });
    await expect(shareReview(db, as(bruno), id)).rejects.toBeInstanceOf(
      ReviewError,
    );
  });

  it("refuses sharing outside the sharing phase (no pre-calibration ratings)", async () => {
    const cycle = await collectingCycle();
    const id = await submitManagerReview(cycle.id);
    await expect(shareReview(db, as(carla), id)).rejects.toMatchObject({
      code: "not_shareable",
    });
    await expect(shareAll(db, hr, cycle.id)).rejects.toMatchObject({
      code: "not_shareable",
    });
    await transition(db, cycle.id, "manager_review", null);
    await expect(shareReview(db, hr, id)).rejects.toMatchObject({
      code: "not_shareable",
    });
    expect((await managerRequests(cycle.id)).every((r) => !r.sharedAt)).toBe(
      true,
    );
  });

  it("with calibration on, waits for calibration to be published", async () => {
    const cycle = await collectingCycle({
      components: {
        self: true,
        manager: true,
        peer: true,
        upward: false,
        calibration: true,
      },
    });
    const id = await submitManagerReview(cycle.id);
    await transition(db, cycle.id, "manager_review", null);
    await transition(db, cycle.id, "calibration", null);
    await transition(db, cycle.id, "sharing", null);
    await expect(shareReview(db, as(carla), id)).rejects.toMatchObject({
      code: "not_shareable",
    });
    await db
      .update(reviewCycle)
      .set({ calibrationPublishedAt: new Date() })
      .where(eq(reviewCycle.id, cycle.id));
    await shareReview(db, as(carla), id);
    expect(await findMySharedReviewId(db, as(bruno), cycle.id)).toBe(id);
  });

  it("lets the snapshot manager, the reviewer and HR share; not skip-level", async () => {
    const cycle = await collectingCycle();
    const id = await submitManagerReview(cycle.id);
    await toSharing(cycle.id);
    await expect(shareReview(db, as(ana), id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await shareReview(db, hr, id);
  });

  it("shareAll shares only submitted reviews of active participants and audits each; unshare hides it again", async () => {
    const cycle = await collectingCycle({
      participantFilter: { kind: "people", personIds: [ana, bruno, carla] },
    });
    const id = await submitManagerReview(cycle.id);
    // Ana reviews Carla, then Carla is removed: never shared.
    const carlas = await participantOf(cycle.id, carla);
    const carlaReview = (await findManagerRequestId(db, as(ana), carlas.id))!;
    const review = (await getReview(db, as(ana), carlaReview))!;
    await saveDraft(db, as(ana), carlaReview, fillAll(review));
    await submit(db, as(ana), carlaReview);
    await removeParticipant(db, cycle.id, carla);
    await toSharing(cycle.id);

    await expect(shareAll(db, as(carla), cycle.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await shareAll(db, hr, cycle.id)).toBe(1);
    expect(await shareAll(db, hr, cycle.id)).toBe(0); // already shared
    const rows = await managerRequests(cycle.id);
    expect(rows.filter((r) => r.sharedAt).map((r) => r.id)).toEqual([id]);
    const audit = await db.select().from(reviewAudit);
    expect(audit.map((a) => [a.requestId, a.action])).toEqual([[id, "shared"]]);

    await unshare(db, hr, id);
    expect(await getReview(db, as(bruno), id)).toBeNull();
    const actions = (
      await db.select().from(reviewAudit).where(eq(reviewAudit.requestId, id))
    ).map((a) => a.action);
    expect(actions.sort()).toEqual(["shared", "unshared"]);
    await expect(unshare(db, as(carla), id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("hides a shared review from a reviewee removed afterwards", async () => {
    const cycle = await collectingCycle();
    const id = await submitManagerReview(cycle.id);
    await toSharing(cycle.id);
    await shareReview(db, as(carla), id);
    await removeParticipant(db, cycle.id, bruno);
    expect(await findMySharedReviewId(db, as(bruno), cycle.id)).toBeNull();
    expect(await getReview(db, as(bruno), id)).toBeNull();
    expect((await listMyTasks(db, as(bruno))).sharedReviews).toEqual([]);
  });
});

describe("reviewer changes", () => {
  it("reassigns a draft manager review when a re-added participant has a new manager", async () => {
    const cycle = await collectingCycle();
    const before = await participantOf(cycle.id, bruno);
    const id = (await findManagerRequestId(db, as(carla), before.id))!;
    await removeParticipant(db, cycle.id, bruno);
    await addParticipant(db, cycle.id, bruno, "2024-01-01"); // reports to Ana
    const rows = (await managerRequests(cycle.id)).filter(
      (r) => r.participantId === before.id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, reviewerPersonId: ana });
    expect(rows[0].reviewerMismatch).toBe(false);
    const audit = await db
      .select()
      .from(reviewAudit)
      .where(eq(reviewAudit.requestId, id));
    expect(audit.map((a) => a.action)).toEqual(["reviewer_reassigned"]);
    expect(await findManagerRequestId(db, as(ana), before.id)).toBe(id);
  });

  it("keeps a submitted review and flags reviewer_mismatch", async () => {
    const cycle = await collectingCycle();
    const id = await submitManagerReview(cycle.id);
    await removeParticipant(db, cycle.id, bruno);
    await addParticipant(db, cycle.id, bruno, "2024-01-01");
    const [row] = (await managerRequests(cycle.id)).filter((r) => r.id === id);
    expect(row.reviewerPersonId).toBe(carla);
    expect(row.status).toBe("submitted");
    expect(row.reviewerMismatch).toBe(true);
  });
});

describe("skip level", () => {
  it("detects the manager of the snapshot manager", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    expect(await isSkipLevel(db, as(ana), p)).toBe(true);
    expect(await isSkipLevel(db, as(carla), p)).toBe(false);
    expect(await isSkipLevel(db, as(bruno), p)).toBe(false);
  });

  it("reads a submitted self review; the manager review only once sharing", async () => {
    const cycle = await collectingCycle();
    const selfId = (await findMySelfRequestId(db, as(bruno), cycle.id))!;
    expect(await getReview(db, as(ana, "manager"), selfId)).toBeNull();
    await submitSelf(cycle.id);
    const seen = (await getReview(db, as(ana, "manager"), selfId))!;
    expect(seen.canWrite).toBe(false);
    const managerId = await submitManagerReview(cycle.id);
    expect(await getReview(db, as(ana), managerId)).toBeNull();
    await toSharing(cycle.id);
    expect(await getReview(db, as(ana), managerId)).not.toBeNull();
  });
});

describe("team view and reminders", () => {
  it("lists the actor's direct reports as of the snapshot with statuses", async () => {
    const cycle = await collectingCycle();
    expect(await listTeam(db, as(bruno))).toEqual([]);
    const rows = await listTeam(db, as(carla, "manager"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cycleId: cycle.id,
      revieweeName: "Bruno Pérez",
      selfStatus: "draft",
      managerStatus: "draft",
      sharedAt: null,
    });
    const id = await submitManagerReview(cycle.id);
    await toSharing(cycle.id);
    await shareReview(db, as(carla), id);
    const [after] = await listTeam(db, as(carla));
    expect(after.managerStatus).toBe("submitted");
    expect(after.sharedAt).not.toBeNull();
  });

  it("records a reminder for a direct report's self review", async () => {
    const cycle = await collectingCycle();
    const [row] = await listTeam(db, as(carla));
    await sendReminder(db, as(carla), row.selfRequestId!);
    const audit = await db
      .select()
      .from(reviewAudit)
      .where(eq(reviewAudit.requestId, row.selfRequestId!));
    expect(audit.map((a) => a.action)).toEqual(["reminder_sent"]);
    const anaSelf = (await findMySelfRequestId(db, as(ana), cycle.id))!;
    await expect(sendReminder(db, as(carla), anaSelf)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("refuses reminders for submitted reviews, removed participants or closed cycles", async () => {
    const cycle = await collectingCycle();
    const selfId = await submitSelf(cycle.id);
    await expect(sendReminder(db, as(carla), selfId)).rejects.toMatchObject({
      code: "not_remindable",
    });

    const other = await collectingCycle({ name: "H2" });
    const otherSelf = (await findMySelfRequestId(db, as(bruno), other.id))!;
    await removeParticipant(db, other.id, bruno);
    await expect(sendReminder(db, as(carla), otherSelf)).rejects.toMatchObject({
      code: "not_remindable",
    });

    const third = await collectingCycle({ name: "H3" });
    const thirdSelf = (await findMySelfRequestId(db, as(bruno), third.id))!;
    await db
      .update(reviewCycle)
      .set({ status: "closed" })
      .where(eq(reviewCycle.id, third.id));
    await expect(sendReminder(db, as(carla), thirdSelf)).rejects.toMatchObject({
      code: "not_remindable",
    });
  });
});
