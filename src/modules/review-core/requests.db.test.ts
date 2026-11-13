import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  cycleParticipant,
  person,
  reviewAudit,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { listTemplates, seedSystemTemplates } from "@/modules/templates";
import {
  addParticipant,
  createCycle,
  findMySelfRequestId,
  getSelfReview,
  launchCycle,
  listMyTasks,
  listSelfRequests,
  removeParticipant,
  ReviewError,
  saveDraft,
  submit,
  transition,
  unlock,
  type CycleInput,
} from ".";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let ana: string;
let bruno: string;
let carla: string;
let templateId: string;

const hr: ActorContext = { personId: null, role: "hr" };
const as = (personId: string): ActorContext => ({
  personId,
  role: "employee",
});

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
  const dir = await mkdtemp(path.join(tmpdir(), "requests-"));
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
    dueDates: { self: "2022-07-15" },
    participantFilter: { kind: "people", personIds: [ana, bruno] },
    ...overrides,
  };
}

const selfRequests = (cycleId: string) =>
  db
    .select()
    .from(reviewRequest)
    .where(
      and(
        eq(reviewRequest.cycleId, cycleId),
        eq(reviewRequest.relationship, "self"),
      ),
    );

/** A cycle in collecting with Ana and Bruno. */
async function collectingCycle(overrides: Partial<CycleInput> = {}) {
  const cycle = await createCycle(db, input(overrides));
  await launchCycle(db, cycle.id, null);
  await transition(db, cycle.id, "collecting", null);
  return cycle;
}

async function brunoRequest(cycleId: string) {
  const id = await findMySelfRequestId(db, as(bruno), cycleId);
  return (await getSelfReview(db, as(bruno), id!))!;
}

/** Text answers for every question of the review. */
const fillAll = (review: Awaited<ReturnType<typeof brunoRequest>>) =>
  review.questions.map((q) => ({
    questionRevisionId: q.id,
    value: `Respuesta ${q.sort}`,
  }));

describe("self requests on entering collecting", () => {
  it("creates exactly one draft self request per participant", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    expect(await selfRequests(cycle.id)).toHaveLength(0); // nominations

    await transition(db, cycle.id, "collecting", null);
    const rows = await selfRequests(cycle.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "draft")).toBe(true);
    expect(new Set(rows.map((r) => r.reviewerPersonId))).toEqual(
      new Set([ana, bruno]),
    );
  });

  it("is idempotent when the cycle re-enters collecting", async () => {
    const cycle = await collectingCycle();
    await transition(db, cycle.id, "nominations", null);
    await transition(db, cycle.id, "collecting", null);
    expect(await selfRequests(cycle.id)).toHaveLength(2);
  });

  it("creates them on launch when the cycle starts in collecting", async () => {
    const cycle = await createCycle(
      db,
      input({
        components: {
          self: true,
          manager: true,
          peer: false,
          upward: false,
          calibration: false,
        },
      }),
    );
    await launchCycle(db, cycle.id, null);
    expect(await selfRequests(cycle.id)).toHaveLength(2);
  });

  it("creates none when the self component is off", async () => {
    const cycle = await collectingCycle({
      components: {
        self: false,
        manager: true,
        peer: true,
        upward: false,
        calibration: false,
      },
    });
    expect(await selfRequests(cycle.id)).toHaveLength(0);
  });

  it("gives a participant added mid-collecting one request", async () => {
    const cycle = await collectingCycle();
    await addParticipant(db, cycle.id, carla, "2022-06-01");
    const rows = await selfRequests(cycle.id);
    expect(rows.filter((r) => r.reviewerPersonId === carla)).toHaveLength(1);
    expect(rows).toHaveLength(3);
  });
});

describe("drafts and submit", () => {
  it("saveDraft upserts answers and keeps the request in draft", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    expect(review.questions.length).toBeGreaterThan(0);
    expect(review.questions.every((q) => q.appliesTo.includes("self"))).toBe(
      true,
    );
    const q = review.questions[0].id;

    await saveDraft(db, as(bruno), review.request.id, [
      { questionRevisionId: q, value: "Primera" },
    ]);
    await saveDraft(db, as(bruno), review.request.id, [
      { questionRevisionId: q, value: "Segunda" },
    ]);
    const after = await brunoRequest(cycle.id);
    expect(after.request.status).toBe("draft");
    expect(after.answers[q]).toBe("Segunda");
    expect(
      await db
        .select()
        .from(answer)
        .where(eq(answer.requestId, review.request.id)),
    ).toHaveLength(1);
  });

  it("rejects answers to questions outside the review", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    await expect(
      saveDraft(db, as(bruno), review.request.id, [
        {
          questionRevisionId: "00000000-0000-4000-8000-000000000000",
          value: "x",
        },
      ]),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("submit requires the required answers", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    const err = await submit(db, as(bruno), review.request.id).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ReviewError);
    expect(err).toMatchObject({ code: "missing_required" });
    expect((err as ReviewError).issues.length).toBe(
      review.questions.filter((q) => q.required).length,
    );
  });

  it("submit makes the request immutable", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    await saveDraft(db, as(bruno), review.request.id, fillAll(review));
    await submit(db, as(bruno), review.request.id);

    const after = await brunoRequest(cycle.id);
    expect(after.request.status).toBe("submitted");
    expect(after.request.submittedAt).toBeInstanceOf(Date);
    await expect(
      saveDraft(db, as(bruno), review.request.id, fillAll(review)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      submit(db, as(bruno), review.request.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("another person cannot write someone else's request", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    await expect(
      saveDraft(db, as(ana), review.request.id, fillAll(review)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      saveDraft(db, hr, review.request.id, fillAll(review)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("unlock", () => {
  async function submitted() {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    await saveDraft(db, as(bruno), review.request.id, fillAll(review));
    await submit(db, as(bruno), review.request.id);
    return review.request.id;
  }

  it("lets HR return a submitted request to draft, audited", async () => {
    const id = await submitted();
    await unlock(db, { personId: carla, role: "hr" }, id, "Falta un ejemplo");
    const [row] = await db
      .select()
      .from(reviewRequest)
      .where(eq(reviewRequest.id, id));
    expect(row).toMatchObject({ status: "draft", unlockedBy: carla });
    expect(row.unlockedAt).toBeInstanceOf(Date);
    expect(row.submittedAt).toBeNull();
    const audit = await db
      .select()
      .from(reviewAudit)
      .where(eq(reviewAudit.requestId, id));
    expect(audit).toMatchObject([
      { action: "unlock", actorPersonId: carla, note: "Falta un ejemplo" },
    ]);
    // Editable again.
    await saveDraft(db, as(bruno), id, []);
  });

  it("rejects unlock by an employee", async () => {
    const id = await submitted();
    await expect(unlock(db, as(bruno), id, null)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("rejects unlocking a draft", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    await expect(unlock(db, hr, review.request.id, null)).rejects.toMatchObject(
      { code: "not_submitted" },
    );
  });
});

describe("visibility", () => {
  it("an employee reads only their own self review; HR reads all", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    const id = review.request.id;
    expect(await getSelfReview(db, as(bruno), id)).not.toBeNull();
    expect(await getSelfReview(db, hr, id)).not.toBeNull();
    expect(await getSelfReview(db, as(ana), id)).toBeNull();
    expect(
      await getSelfReview(db, { personId: null, role: "employee" }, id),
    ).toBeNull();
  });

  it("listSelfRequests is for HR only", async () => {
    const cycle = await collectingCycle();
    expect(await listSelfRequests(db, hr, cycle.id)).toHaveLength(2);
    expect(await listSelfRequests(db, as(bruno), cycle.id)).toEqual([]);
  });
});

describe("listMyTasks", () => {
  it("lists only the actor's pending self reviews and empties after submit", async () => {
    const cycle = await collectingCycle();
    const tasks = await listMyTasks(db, as(bruno));
    expect(tasks.selfAssessments).toEqual([
      expect.objectContaining({
        cycleId: cycle.id,
        cycleName: "H1 2022",
        dueDate: "2022-07-15",
      }),
    ]);
    expect(tasks.nominations).toEqual([]);
    expect(tasks.feedback).toEqual([]);
    expect(tasks.acknowledgements).toEqual([]);
    expect((await listMyTasks(db, as(carla))).selfAssessments).toEqual([]);
    expect((await listMyTasks(db, hr)).selfAssessments).toEqual([]);

    const review = await brunoRequest(cycle.id);
    await saveDraft(db, as(bruno), review.request.id, fillAll(review));
    await submit(db, as(bruno), review.request.id);
    expect((await listMyTasks(db, as(bruno))).selfAssessments).toEqual([]);
    expect((await listMyTasks(db, as(ana))).selfAssessments).toHaveLength(1);
  });

  it("hides requests of removed participants", async () => {
    const cycle = await collectingCycle();
    await db
      .update(cycleParticipant)
      .set({ removedAt: new Date() })
      .where(eq(cycleParticipant.revieweePersonId, bruno));
    expect((await listMyTasks(db, as(bruno))).selfAssessments).toEqual([]);
    void cycle;
  });
});

describe("write scope", () => {
  it("rejects saving a self review after collecting", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    await transition(db, cycle.id, "manager_review", null);
    await expect(
      saveDraft(db, as(bruno), review.request.id, fillAll(review)),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await brunoRequest(cycle.id)).canWrite).toBe(false);
  });

  it("rejects saving for a removed participant", async () => {
    const cycle = await collectingCycle();
    const review = await brunoRequest(cycle.id);
    await removeParticipant(db, cycle.id, bruno);
    await expect(
      saveDraft(db, as(bruno), review.request.id, fillAll(review)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
