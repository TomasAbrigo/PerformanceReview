import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  adminAuditLog,
  answer,
  cycleParticipant,
  employeeJobHistory,
  person,
  reviewAudit,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { todayLocal } from "@/modules/org-history/dates";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";
import {
  createCycle,
  findManagerRequestId,
  findMySelfRequestId,
  getReview,
  launchCycle,
  listMyTasks,
  listTeam,
  saveDraft,
  shareReview,
  submit,
  transition,
  type CycleInput,
  type Review,
} from ".";
import { listAuditLog } from "./admin-audit";
import {
  addParticipantOp,
  assignAlternateAssessor,
  completeOnBehalf,
  detectManagerChanges,
  extendDueDate,
  removeParticipantOp,
  unlockRequestOp,
} from "./ops";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

// As of 2022-06-01: Bruno reports to Carla, Carla to Ana, Ana to nobody (CEO).
// Today Bruno reports to Ana (job_history from 2023-01-01).
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
  const dir = await mkdtemp(path.join(tmpdir(), "ops-"));
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
      peer: false,
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

/** Launched cycle with Ana and Bruno, collecting (manager requests exist). */
async function collectingCycle(overrides: Partial<CycleInput> = {}) {
  const cycle = await createCycle(db, input(overrides));
  await launchCycle(db, cycle.id, null);
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

const requestsOf = (participantId: string, relationship: "self" | "manager") =>
  db
    .select()
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.participantId, participantId),
        eq(reviewRequest.relationship, relationship),
      ),
    )
    .orderBy(asc(reviewRequest.requestedAt), asc(reviewRequest.id));

const auditRows = (cycleId: string) =>
  db
    .select()
    .from(adminAuditLog)
    .where(eq(adminAuditLog.cycleId, cycleId))
    .orderBy(asc(adminAuditLog.createdAt));

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

/** Bruno fills and submits his self review. */
async function submitSelf(cycleId: string) {
  const id = (await findMySelfRequestId(db, as(bruno), cycleId))!;
  const review = (await getReview(db, as(bruno), id))!;
  await saveDraft(db, as(bruno), id, fillAll(review));
  await submit(db, as(bruno), id);
  return id;
}

/** `reviewer` fills and submits the manager review of Bruno. */
async function submitManagerReview(cycleId: string, reviewer = carla) {
  const p = await participantOf(cycleId, bruno);
  const id = (await findManagerRequestId(db, as(reviewer), p.id))!;
  const review = (await getReview(db, as(reviewer), id))!;
  await saveDraft(db, as(reviewer), id, fillAll(review));
  await submit(db, as(reviewer), id);
  return id;
}

describe("addParticipantOp", () => {
  it("snapshots the person today, creates their requests and audits once", async () => {
    // Only Ana is in the cycle (snapshot 2022-06-01); Bruno joins mid-cycle.
    const cycle = await collectingCycle({
      participantFilter: { kind: "people", personIds: [ana] },
    });
    const added = await addParticipantOp(db, hr, cycle.id, bruno, {
      note: "Ingresó tarde",
    });
    expect(added.snapshotAsOf).toBe(todayLocal());
    // Today Bruno reports to Ana (he reported to Carla in 2022).
    expect(added.snapManagerPersonId).toBe(ana);

    const self = await requestsOf(added.id, "self");
    const manager = await requestsOf(added.id, "manager");
    expect(self.map((r) => [r.reviewerPersonId, r.status])).toEqual([
      [bruno, "draft"],
    ]);
    expect(manager.map((r) => [r.reviewerPersonId, r.status])).toEqual([
      [ana, "draft"],
    ]);

    const rows = await auditRows(cycle.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "participant_added",
      targetType: "participant",
      targetId: added.id,
      cycleId: cycle.id,
      actorPersonId: null,
      note: "Ingresó tarde",
      before: null,
    });
    expect(rows[0].after).toMatchObject({
      personId: bruno,
      snapshotAsOf: todayLocal(),
      snapManagerPersonId: ana,
    });
  });

  it("takes the snapshot on the date given (and records the actor person)", async () => {
    const cycle = await collectingCycle();
    const actor: ActorContext = { personId: ana, role: "hr" };
    const added = await addParticipantOp(db, actor, cycle.id, carla, {
      asOf: "2022-06-01",
    });
    expect(added.snapshotAsOf).toBe("2022-06-01");
    const [row] = await auditRows(cycle.id);
    expect(row.actorPersonId).toBe(ana);
  });

  it("re-adding a removed participant is audited with their previous state", async () => {
    const cycle = await collectingCycle();
    await removeParticipantOp(db, hr, cycle.id, bruno);
    const again = await addParticipantOp(db, hr, cycle.id, bruno, {
      asOf: "2022-06-01",
    });
    expect(again.removedAt).toBeNull();
    const rows = await auditRows(cycle.id);
    expect(rows.map((r) => r.action)).toEqual([
      "participant_removed",
      "participant_added",
    ]);
    expect(rows[1].before).toMatchObject({ removedAt: expect.any(String) });
    expect(rows[1].after).toMatchObject({ removedAt: null });
  });

  it("is HR only and writes nothing when it fails", async () => {
    const cycle = await collectingCycle();
    await expect(
      addParticipantOp(db, as(carla, "manager"), cycle.id, carla),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      addParticipantOp(db, hr, cycle.id, bruno),
    ).rejects.toMatchObject({ code: "already_participant" });
    expect(await auditRows(cycle.id)).toHaveLength(0);
    const draft = await createCycle(db, input());
    await expect(
      addParticipantOp(db, hr, draft.id, carla),
    ).rejects.toMatchObject({ code: "not_active" });
  });
});

describe("removeParticipantOp", () => {
  it("keeps the participant and their requests, blocks writes and audits once", async () => {
    const cycle = await collectingCycle();
    const selfId = (await findMySelfRequestId(db, as(bruno), cycle.id))!;
    const before = await participantOf(cycle.id, bruno);
    await removeParticipantOp(db, hr, cycle.id, bruno, { note: "Renunció" });

    const after = await participantOf(cycle.id, bruno);
    expect(after.id).toBe(before.id);
    expect(after.removedAt).not.toBeNull();
    // Decision: open requests keep their draft (history stays); canWrite
    // blocks them through removed_at and the task inbox hides them.
    expect((await requestsOf(after.id, "self"))[0].status).toBe("draft");
    expect((await requestsOf(after.id, "manager"))[0].status).toBe("draft");
    const review = (await getReview(db, as(bruno), selfId))!;
    expect(review.canWrite).toBe(false);
    await expect(
      saveDraft(db, as(bruno), selfId, [
        { questionRevisionId: review.questions[0].id, value: "x" },
      ]),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await listMyTasks(db, as(bruno))).selfAssessments).toHaveLength(0);

    const rows = await auditRows(cycle.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "participant_removed",
      targetType: "participant",
      targetId: before.id,
      note: "Renunció",
    });
    expect(rows[0].before).toMatchObject({ removedAt: null });
    expect(rows[0].after).toMatchObject({ removedAt: expect.any(String) });
  });

  it("fails without an audit row when the person is not an active participant", async () => {
    const cycle = await collectingCycle();
    await expect(
      removeParticipantOp(db, hr, cycle.id, carla),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      removeParticipantOp(db, as(bruno), cycle.id, bruno),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await auditRows(cycle.id)).toHaveLength(0);
  });
});

describe("extendDueDate", () => {
  it("moves a phase forward and audits the old and new date", async () => {
    const cycle = await collectingCycle();
    const updated = await extendDueDate(
      db,
      hr,
      cycle.id,
      "manager",
      "2022-08-15",
      { note: "Vacaciones" },
    );
    expect(updated.dueDates).toEqual({
      self: "2022-07-15",
      manager: "2022-08-15",
    });
    const [row] = await auditRows(cycle.id);
    expect(await auditRows(cycle.id)).toHaveLength(1);
    expect(row).toMatchObject({
      action: "due_date_extended",
      targetType: "cycle",
      targetId: cycle.id,
      note: "Vacaciones",
      before: { phase: "manager", date: "2022-07-30" },
      after: { phase: "manager", date: "2022-08-15" },
    });
  });

  it("only moves forward: same, earlier or missing dates are refused", async () => {
    const cycle = await collectingCycle();
    for (const date of ["2022-07-30", "2022-07-29"]) {
      await expect(
        extendDueDate(db, hr, cycle.id, "manager", date),
      ).rejects.toMatchObject({ code: "date_not_forward" });
    }
    // Nothing to extend when the phase has no deadline.
    await expect(
      extendDueDate(db, hr, cycle.id, "calibration", "2022-09-01"),
    ).rejects.toMatchObject({ code: "date_not_forward" });
    expect(await auditRows(cycle.id)).toHaveLength(0);
    const [stored] = await db
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.id, cycle.id));
    expect(stored.dueDates.manager).toBe("2022-07-30");
  });

  it("validates input, the cycle state and the phase order", async () => {
    const cycle = await collectingCycle({
      dueDates: {
        self: "2022-07-15",
        manager: "2022-07-30",
        sharing: "2022-08-30",
      },
    });
    await expect(
      extendDueDate(db, hr, cycle.id, "manager", "nope"),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      extendDueDate(db, hr, cycle.id, "bogus" as never, "2022-09-01"),
    ).rejects.toMatchObject({ code: "validation" });
    // Pushing manager past the sharing date would break the phase order.
    await expect(
      extendDueDate(db, hr, cycle.id, "manager", "2022-09-30"),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      extendDueDate(db, as(bruno), cycle.id, "manager", "2022-08-01"),
    ).rejects.toMatchObject({ code: "forbidden" });
    const draft = await createCycle(db, input());
    await expect(
      extendDueDate(db, hr, draft.id, "manager", "2022-08-15"),
    ).rejects.toMatchObject({ code: "not_active" });
    expect(await auditRows(cycle.id)).toHaveLength(0);
  });
});

describe("unlockRequestOp", () => {
  it("returns a submitted request to draft, hides the opposite side and audits", async () => {
    const cycle = await collectingCycle();
    const selfId = await submitSelf(cycle.id);
    const managerId = await submitManagerReview(cycle.id);
    await shareReview(db, as(carla), managerId);
    // Both submitted: Carla reads the self review, Bruno the shared review.
    expect(await getReview(db, as(carla), selfId)).not.toBeNull();
    expect(await getReview(db, as(bruno), managerId)).not.toBeNull();

    const unlocked = await unlockRequestOp(db, hr, managerId, "Corregir nota");
    expect(unlocked).toMatchObject({
      status: "draft",
      submittedAt: null,
      sharedAt: null,
    });
    expect(unlocked.unlockedAt).not.toBeNull();

    // Double blind applies again until she resubmits; the employee no longer
    // sees the (unshared) manager review.
    expect(await getReview(db, as(carla), selfId)).toBeNull();
    expect(await getReview(db, as(bruno), managerId)).toBeNull();
    // Her answers are kept for the correction.
    const mine = (await getReview(db, as(carla), managerId))!;
    expect(mine.canWrite).toBe(true);
    expect(Object.keys(mine.answers).length).toBeGreaterThan(0);

    const rows = await auditRows(cycle.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "request_unlocked",
      targetType: "request",
      targetId: managerId,
      note: "Corregir nota",
      before: { status: "submitted" },
      after: { status: "draft" },
    });
    // The #12 audit of request actions keeps recording it too.
    const requestAudit = await db
      .select()
      .from(reviewAudit)
      .where(eq(reviewAudit.requestId, managerId));
    expect(requestAudit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["unlock"]),
    );

    // Resubmitting shows her the self review again; sharing is manual.
    await submit(db, as(carla), managerId);
    expect(await getReview(db, as(carla), selfId)).not.toBeNull();
    expect(await getReview(db, as(bruno), managerId)).toBeNull();
  });

  it("unlocks a self request and hides nothing else", async () => {
    const cycle = await collectingCycle();
    const selfId = await submitSelf(cycle.id);
    await unlockRequestOp(db, hr, selfId, null);
    const [row] = await requestsOf(
      (await participantOf(cycle.id, bruno)).id,
      "self",
    );
    expect(row.status).toBe("draft");
    expect(await auditRows(cycle.id)).toHaveLength(1);
  });

  it("refuses drafts and non-HR actors without writing audit rows", async () => {
    const cycle = await collectingCycle();
    const selfId = (await findMySelfRequestId(db, as(bruno), cycle.id))!;
    await expect(unlockRequestOp(db, hr, selfId, null)).rejects.toMatchObject({
      code: "not_submitted",
    });
    await submitSelf(cycle.id);
    await expect(
      unlockRequestOp(db, as(carla, "manager"), selfId, null),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await auditRows(cycle.id)).toHaveLength(0);
  });
});

describe("completeOnBehalf", () => {
  async function brunoSelf(cycleId: string) {
    return (await findMySelfRequestId(db, as(bruno), cycleId))!;
  }

  it("saves and submits as the reviewer, marks it and audits answers", async () => {
    const cycle = await collectingCycle();
    const id = await brunoSelf(cycle.id);
    const empty = (await getReview(db, hr, id))!;
    const actor: ActorContext = { personId: ana, role: "hr" };
    const done = await completeOnBehalf(db, actor, id, fillAll(empty), {
      note: "Está de licencia",
    });
    expect(done).toMatchObject({
      status: "submitted",
      submittedOnBehalf: true,
      submittedOnBehalfBy: ana,
      reviewerPersonId: bruno,
    });
    expect(done.submittedAt).not.toBeNull();
    const stored = await db
      .select()
      .from(answer)
      .where(eq(answer.requestId, id));
    expect(stored).toHaveLength(empty.questions.length);

    const rows = await auditRows(cycle.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "completed_on_behalf",
      targetType: "request",
      targetId: id,
      actorPersonId: ana,
      note: "Está de licencia",
      before: { status: "draft", answers: {} },
      after: { status: "submitted" },
    });
    const after = rows[0].after as { answers: Record<string, unknown> };
    expect(Object.keys(after.answers)).toHaveLength(empty.questions.length);
  });

  it("works after an unlock to edit a submitted review (diff in the audit)", async () => {
    const cycle = await collectingCycle();
    const id = await submitSelf(cycle.id);
    await unlockRequestOp(db, hr, id, null);
    const review = (await getReview(db, hr, id))!;
    const text = review.questions.find((q) => q.kind === "text")!;
    await completeOnBehalf(db, hr, id, [
      { questionRevisionId: text.id, value: "Editado por People" },
    ]);
    const rows = await auditRows(cycle.id);
    expect(rows.map((r) => r.action)).toEqual([
      "request_unlocked",
      "completed_on_behalf",
    ]);
    const before = rows[1].before as { answers: Record<string, unknown> };
    const after = rows[1].after as { answers: Record<string, unknown> };
    expect(before.answers[text.id]).toBe(`Respuesta ${text.sort}`);
    expect(after.answers[text.id]).toBe("Editado por People");
  });

  it("refuses incomplete answers, submitted requests, missing reviewers and removed people", async () => {
    const cycle = await collectingCycle();
    const id = await brunoSelf(cycle.id);
    await expect(completeOnBehalf(db, hr, id, [])).rejects.toMatchObject({
      code: "missing_required",
    });
    expect(await auditRows(cycle.id)).toHaveLength(0);
    expect((await getReview(db, hr, id))!.request.submittedOnBehalf).toBe(
      false,
    );

    await expect(
      completeOnBehalf(db, as(carla, "manager"), id, []),
    ).rejects.toMatchObject({ code: "forbidden" });

    // Ana has no manager: her manager request has no reviewer yet.
    const anas = await participantOf(cycle.id, ana);
    const [missing] = await requestsOf(anas.id, "manager");
    await expect(
      completeOnBehalf(db, hr, missing.id, []),
    ).rejects.toMatchObject({ code: "reviewer_missing" });

    const review = (await getReview(db, hr, id))!;
    await completeOnBehalf(db, hr, id, fillAll(review));
    await expect(
      completeOnBehalf(db, hr, id, fillAll(review)),
    ).rejects.toMatchObject({ code: "not_draft" });

    const [brunosManager] = await requestsOf(
      (await participantOf(cycle.id, bruno)).id,
      "manager",
    );
    await removeParticipantOp(db, hr, cycle.id, bruno);
    await expect(
      completeOnBehalf(db, hr, brunosManager.id, []),
    ).rejects.toMatchObject({ code: "not_writable" });
    expect(await auditRows(cycle.id)).toHaveLength(2); // complete + remove
  });
});

describe("assignAlternateAssessor", () => {
  it("replace on a draft moves the manager request and flags the mismatch", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const [before] = await requestsOf(p.id, "manager");
    expect(before).toMatchObject({
      reviewerPersonId: carla,
      reviewerMismatch: false,
    });

    const result = await assignAlternateAssessor(db, hr, p.id, ana, "replace", {
      note: "Carla con licencia",
    });
    expect(result.id).toBe(before.id);
    const [after] = await requestsOf(p.id, "manager");
    expect(after).toMatchObject({
      id: before.id,
      reviewerPersonId: ana,
      reviewerMismatch: true,
      reviewerMissing: false,
      additional: false,
      status: "draft",
    });
    // Ana writes it; the old manager no longer does.
    expect((await getReview(db, as(ana), before.id))!.canWrite).toBe(true);
    expect((await getReview(db, as(carla), before.id))!.canWrite).toBe(false);
    expect(await findManagerRequestId(db, as(ana), p.id)).toBe(before.id);

    const rows = await auditRows(cycle.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "assessor_assigned",
      targetType: "participant",
      targetId: p.id,
      note: "Carla con licencia",
      before: { reviewerPersonId: carla, requestId: before.id },
      after: {
        mode: "replace",
        reviewerPersonId: ana,
        requestId: before.id,
        reviewerMismatch: true,
      },
    });
  });

  it("replace on a submitted review supersedes it and creates a new request", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const oldId = await submitManagerReview(cycle.id);

    const created = await assignAlternateAssessor(db, hr, p.id, ana, "replace");
    expect(created.id).not.toBe(oldId);
    const rows = await requestsOf(p.id, "manager");
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.id === oldId)!;
    const fresh = rows.find((r) => r.id === created.id)!;
    expect(old.status).toBe("superseded");
    expect(old.reviewerPersonId).toBe(carla);
    expect(fresh).toMatchObject({
      status: "draft",
      reviewerPersonId: ana,
      reviewerMismatch: true,
      additional: false,
    });
    // History keeps the superseded answers; the current request starts empty.
    expect(
      (await db.select().from(answer).where(eq(answer.requestId, oldId)))
        .length,
    ).toBeGreaterThan(0);
    expect(
      await db.select().from(answer).where(eq(answer.requestId, fresh.id)),
    ).toHaveLength(0);
    expect(await findManagerRequestId(db, as(ana), p.id)).toBe(fresh.id);

    const [row] = await auditRows(cycle.id);
    expect(await auditRows(cycle.id)).toHaveLength(1);
    expect(row.before).toMatchObject({ requestId: oldId, status: "submitted" });
    expect(row.after).toMatchObject({
      requestId: fresh.id,
      supersededRequestId: oldId,
    });
  });

  it("replacing back revives the superseded request", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const oldId = await submitManagerReview(cycle.id);
    await assignAlternateAssessor(db, hr, p.id, ana, "replace");
    const back = await assignAlternateAssessor(db, hr, p.id, carla, "replace");
    expect(back.id).toBe(oldId);
    const rows = await requestsOf(p.id, "manager");
    expect(rows.map((r) => [r.reviewerPersonId, r.status])).toEqual(
      expect.arrayContaining([
        [carla, "submitted"],
        [ana, "superseded"],
      ]),
    );
    expect(rows.find((r) => r.id === oldId)!.reviewerMismatch).toBe(false);
    expect(await auditRows(cycle.id)).toHaveLength(2);
  });

  it("additional adds a second manager request and keeps the first", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const [primary] = await requestsOf(p.id, "manager");
    const extra = await assignAlternateAssessor(
      db,
      hr,
      p.id,
      ana,
      "additional",
    );
    expect(extra.id).not.toBe(primary.id);
    const rows = await requestsOf(p.id, "manager");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === primary.id)).toMatchObject({
      reviewerPersonId: carla,
      additional: false,
      reviewerMismatch: false,
      status: "draft",
    });
    expect(rows.find((r) => r.id === extra.id)).toMatchObject({
      reviewerPersonId: ana,
      additional: true,
      reviewerMismatch: true,
      status: "draft",
    });
    // Each reviewer opens their own request.
    expect(await findManagerRequestId(db, as(ana), p.id)).toBe(extra.id);
    expect(await findManagerRequestId(db, as(carla), p.id)).toBe(primary.id);
    const [row] = await auditRows(cycle.id);
    expect(await auditRows(cycle.id)).toHaveLength(1);
    expect(row.after).toMatchObject({
      mode: "additional",
      requestId: extra.id,
    });
    // The same person twice is refused.
    await expect(
      assignAlternateAssessor(db, hr, p.id, ana, "additional"),
    ).rejects.toMatchObject({ code: "already_assigned" });
    await expect(
      assignAlternateAssessor(db, hr, p.id, carla, "replace"),
    ).rejects.toMatchObject({ code: "same_reviewer" });
    expect(await auditRows(cycle.id)).toHaveLength(1);
  });

  it("requires an assessor for a participant without a manager (CEO)", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, ana);
    const [missing] = await requestsOf(p.id, "manager");
    expect(missing).toMatchObject({
      reviewerPersonId: null,
      reviewerMissing: true,
    });
    // Adding a second reviewer would leave the missing slot empty.
    await expect(
      assignAlternateAssessor(db, hr, p.id, carla, "additional"),
    ).rejects.toMatchObject({ code: "replace_required" });
    expect(await auditRows(cycle.id)).toHaveLength(0);

    await assignAlternateAssessor(db, hr, p.id, carla, "replace");
    const [fixed] = await requestsOf(p.id, "manager");
    expect(fixed).toMatchObject({
      id: missing.id,
      reviewerPersonId: carla,
      reviewerMissing: false,
      // No snapshot manager to differ from: not a mismatch.
      reviewerMismatch: false,
    });
    expect(await auditRows(cycle.id)).toHaveLength(1);

    // The assessor finds the person in their team view.
    const team = await listTeam(db, as(carla, "manager"));
    // (Bruno too: Carla was his manager at the snapshot.)
    expect(team.map((t) => t.revieweeName)).toEqual([
      "Ana García",
      "Bruno Pérez",
    ]);
    expect(team[0].managerRequestId).toBe(fixed.id);

    // The assessor reads the CEO's self review only after submitting theirs.
    const selfId = (await findMySelfRequestId(db, as(ana), cycle.id))!;
    const selfReview = (await getReview(db, as(ana), selfId))!;
    await saveDraft(db, as(ana), selfId, fillAll(selfReview));
    await submit(db, as(ana), selfId);
    expect(await getReview(db, as(carla, "manager"), selfId)).toBeNull();
    const review = (await getReview(db, as(carla), fixed.id))!;
    expect(review.canWrite).toBe(true);
    await saveDraft(db, as(carla), fixed.id, fillAll(review));
    await submit(db, as(carla), fixed.id);
    expect(await getReview(db, as(carla, "manager"), selfId)).not.toBeNull();
  });

  it("needs the manager requests to exist and an active participant", async () => {
    const cycle = await createCycle(
      db,
      input({
        components: {
          self: true,
          manager: true,
          peer: true,
          upward: false,
          calibration: false,
        },
      }),
    );
    await launchCycle(db, cycle.id, null); // nominations: no manager requests
    const p = await participantOf(cycle.id, bruno);
    await expect(
      assignAlternateAssessor(db, hr, p.id, ana, "replace"),
    ).rejects.toMatchObject({ code: "no_manager_request" });
    await transition(db, cycle.id, "collecting", null);
    await expect(
      assignAlternateAssessor(db, as(carla), p.id, ana, "replace"),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      assignAlternateAssessor(
        db,
        hr,
        "00000000-0000-4000-8000-000000000999",
        ana,
        "replace",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await removeParticipantOp(db, hr, cycle.id, bruno);
    await expect(
      assignAlternateAssessor(db, hr, p.id, ana, "replace"),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await auditRows(cycle.id)).toHaveLength(1); // only the removal
  });
});

describe("detectManagerChanges", () => {
  it("lists participants whose current manager differs from the snapshot", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    const [request] = await requestsOf(p.id, "manager");
    // Bruno reported to Carla on 2022-06-01 and reports to Ana since 2023.
    expect(await detectManagerChanges(db, cycle.id, "2022-12-31")).toEqual([]);
    const changes = await detectManagerChanges(db, cycle.id, "2024-06-01");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      participantId: p.id,
      revieweePersonId: bruno,
      revieweeName: "Bruno Pérez",
      snapshotManagerId: carla,
      snapshotManagerName: "Carla Romero",
      currentManagerId: ana,
      currentManagerName: "Ana García",
      requestId: request.id,
      reviewerId: carla,
      reviewerMismatch: false,
      suggestedAction: "reassign",
    });
  });

  it("suggests adding an assessor once the review is submitted, and none once handled", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await submitManagerReview(cycle.id);
    const [submitted] = await detectManagerChanges(db, cycle.id, "2024-06-01");
    expect(submitted.suggestedAction).toBe("add_assessor");

    await assignAlternateAssessor(db, hr, p.id, ana, "additional");
    const [handled] = await detectManagerChanges(db, cycle.id, "2024-06-01");
    expect(handled).toMatchObject({
      participantId: p.id,
      suggestedAction: "none",
    });
  });

  it("flags the mismatch when the reviewer is not the snapshot manager", async () => {
    const cycle = await collectingCycle();
    const p = await participantOf(cycle.id, bruno);
    await assignAlternateAssessor(db, hr, p.id, ana, "replace");
    const [change] = await detectManagerChanges(db, cycle.id, "2024-06-01");
    expect(change).toMatchObject({
      reviewerId: ana,
      reviewerMismatch: true,
      suggestedAction: "none", // the reviewer is the current manager
    });
  });

  it("notices a job_history change made after launch", async () => {
    const cycle = await collectingCycle();
    // Ana (CEO, no manager at the snapshot) starts reporting to Carla.
    await db
      .update(employeeJobHistory)
      .set({ validTo: "2024-06-01" })
      .where(
        and(
          eq(employeeJobHistory.personId, ana),
          sql`${employeeJobHistory.validTo} is null`,
        ),
      );
    await db.insert(employeeJobHistory).values({
      personId: ana,
      validFrom: "2024-06-01",
      managerPersonId: carla,
      department: "Dirección",
      jobTitle: "CEO",
    });
    const changes = await detectManagerChanges(db, cycle.id, "2024-07-01");
    const anas = await participantOf(cycle.id, ana);
    expect(changes.map((c) => c.revieweePersonId).sort()).toEqual(
      [ana, bruno].sort(),
    );
    expect(changes.find((c) => c.participantId === anas.id)).toMatchObject({
      snapshotManagerId: null,
      currentManagerId: carla,
      reviewerId: null,
      suggestedAction: "reassign",
    });
  });

  it("ignores removed participants and people without a job row that day", async () => {
    const cycle = await collectingCycle();
    // Nobody had a job (so a manager) in 2010: not a change.
    expect(await detectManagerChanges(db, cycle.id, "2010-01-01")).toEqual([]);
    await removeParticipantOp(db, hr, cycle.id, bruno);
    expect(await detectManagerChanges(db, cycle.id, "2024-06-01")).toEqual([]);
  });
});

describe("listAuditLog", () => {
  it("lists the cycle's entries newest first with actor and target, filterable", async () => {
    const cycle = await collectingCycle();
    const actor: ActorContext = { personId: ana, role: "hr" };
    await extendDueDate(db, actor, cycle.id, "manager", "2022-08-15");
    await addParticipantOp(db, actor, cycle.id, carla, { asOf: "2022-06-01" });
    const p = await participantOf(cycle.id, carla);
    await assignAlternateAssessor(db, actor, p.id, bruno, "additional");

    const all = await listAuditLog(db, hr, cycle.id);
    expect(all.map((e) => e.action)).toEqual([
      "assessor_assigned",
      "participant_added",
      "due_date_extended",
    ]);
    expect(all[0]).toMatchObject({
      actorName: "Ana García",
      targetLabel: "Carla Romero",
    });
    expect(all[2].targetLabel).toBeNull();
    const only = await listAuditLog(db, hr, cycle.id, {
      action: "participant_added",
    });
    expect(only).toHaveLength(1);
    expect(only[0].after).toMatchObject({ personId: carla });
    await expect(
      listAuditLog(db, as(ana, "manager"), cycle.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
