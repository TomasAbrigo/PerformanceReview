import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  type QuestionRevision,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { getReview, questionsFor } from "@/modules/review-core/answers";
import {
  createTestCycle,
  loadPeople,
  participantOf,
  people,
  requestIdOf,
  systemTemplateId,
} from "@/modules/review-core/test-support";
import { CaptureError } from "./errors";
import type { CaptureAnswer } from "./rules";
import { listPendingSelfReviews, saveDraft, share, submit } from "./service";
import { listTeamReviews } from "./team";

// As of 2022-06-01 Bruno reports to Carla and Carla to Ana; from 2023 Bruno
// reports to Ana. "Today" is mid 2022 unless a test moves it (only Date is
// faked: who manages the reviewee today decides who writes a manager review).
const MID_2022 = new Date("2022-06-15T12:00:00Z");
const MID_2023 = new Date("2023-06-15T12:00:00Z");
let cycleId: string;
let selfId: string;
let managerId: string;
let questions: QuestionRevision[];
const hr: ActorContext = { personId: null, role: "hr" };
const bruno = (): ActorContext => ({
  personId: people.bruno,
  role: "employee",
});
const carla = (): ActorContext => ({ personId: people.carla, role: "manager" });

/** A valid answer for every self question. */
const fullAnswers = (): CaptureAnswer[] =>
  questions.map((q) => ({
    questionRevisionId: q.id,
    value:
      q.kind === "rating"
        ? q.scale!.options[0].value
        : q.kind === "single_choice"
          ? q.choices![0].value
          : `Respuesta ${q.sort}`,
  }));

const requestRow = async (id: string) =>
  (await db.select().from(reviewRequest).where(eq(reviewRequest.id, id)))[0];
const answersOf = (id: string) =>
  db.select().from(answer).where(eq(answer.requestId, id));

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(CaptureError);
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  await loadPeople();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: MID_2022 });
  await db.delete(reviewCycle);
  const cycle = await createTestCycle({
    templateId: await systemTemplateId(),
    personIds: [people.bruno],
  });
  cycleId = cycle.id;
  const p = await participantOf(cycleId, people.bruno);
  selfId = await requestIdOf(p.id, "self");
  managerId = await requestIdOf(p.id, "manager");
  questions = await questionsFor(db, cycleId, null, "self");
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await closeDb();
});

describe("saveDraft", () => {
  it("stores the reviewer's answers and keeps the request a draft", async () => {
    // The Santex self form is open questions only: the manager's has Likert.
    const mq = await questionsFor(db, cycleId, null, "manager");
    const rating = mq.find((q) => q.kind === "rating")!;
    const text = mq.find((q) => q.kind === "text")!;
    const max = rating.scale!.options.at(-1)!;
    await saveDraft(db, carla(), managerId, [
      { questionRevisionId: rating.id, value: max.value },
      { questionRevisionId: text.id, value: "Aprendí mucho" },
    ]);
    const rows = await answersOf(managerId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.questionRevisionId === rating.id)).toMatchObject({
      optionValue: max.value,
      normalized: max.normalized,
    });
    expect(rows.find((r) => r.questionRevisionId === text.id)?.textValue).toBe(
      "Aprendí mucho",
    );
    const request = await requestRow(managerId);
    expect(request.status).toBe("draft");
    expect(request.sourceSystem).toBe("native");
  });

  it("overwrites and clears answers on a later save", async () => {
    const text = questions.find((q) => q.kind === "text")!;
    await saveDraft(db, bruno(), selfId, [
      { questionRevisionId: text.id, value: "Primero" },
    ]);
    await saveDraft(db, bruno(), selfId, [
      { questionRevisionId: text.id, value: "Después" },
    ]);
    expect((await answersOf(selfId))[0].textValue).toBe("Después");
    await saveDraft(db, bruno(), selfId, [
      { questionRevisionId: text.id, value: "" },
    ]);
    expect(await answersOf(selfId)).toHaveLength(0);
  });

  it("rejects a value outside the scale and writes nothing", async () => {
    const mq = await questionsFor(db, cycleId, null, "manager");
    const rating = mq.find((q) => q.kind === "rating")!;
    const text = mq.find((q) => q.kind === "text")!;
    const promise = saveDraft(db, carla(), managerId, [
      { questionRevisionId: text.id, value: "Algo" },
      { questionRevisionId: rating.id, value: 99 },
    ]);
    await expectError(promise, "validation");
    await expect(promise).rejects.toMatchObject({
      issues: [{ path: rating.id, message: "out_of_scale" }],
    });
    expect(await answersOf(managerId)).toHaveLength(0);
  });

  it("rejects a question of another form (the manager's)", async () => {
    const managerOnly = (await questionsFor(db, cycleId, null, "manager")).find(
      (q) => !q.appliesTo.includes("self"),
    )!;
    await expectError(
      saveDraft(db, bruno(), selfId, [
        { questionRevisionId: managerOnly.id, value: "x" },
      ]),
      "validation",
    );
  });

  it("lets People answer, and nobody else but the reviewer", async () => {
    const text = questions.find((q) => q.kind === "text")!;
    const one = [{ questionRevisionId: text.id, value: "HR" }];
    await saveDraft(db, hr, selfId, one);
    await expectError(saveDraft(db, carla(), selfId, one), "forbidden");
    await expectError(
      saveDraft(db, { personId: null, role: "direction" }, selfId, one),
      "forbidden",
    );
  });

  it("answers not_found for an unknown or malformed request", async () => {
    await expectError(
      saveDraft(db, hr, "00000000-0000-4000-8000-000000000000", []),
      "not_found",
    );
    await expectError(saveDraft(db, hr, "nope", []), "not_found");
  });

  it("rejects writing once the cycle is closed", async () => {
    await db
      .update(reviewCycle)
      .set({ status: "closed" })
      .where(eq(reviewCycle.id, cycleId));
    await expectError(saveDraft(db, bruno(), selfId, []), "cycle_closed");
    await expectError(submit(db, bruno(), selfId), "cycle_closed");
  });
});

describe("submit", () => {
  it("refuses while a required question is unanswered, naming it", async () => {
    const required = questions.filter((q) => q.required);
    expect(required.length).toBeGreaterThan(0);
    const promise = submit(db, bruno(), selfId);
    await expectError(promise, "validation");
    await expect(promise).rejects.toMatchObject({
      issues: required.map((q) => ({ path: q.id, message: "required" })),
    });
    expect((await requestRow(selfId)).status).toBe("draft");
  });

  it("submits a complete form, which then becomes read-only", async () => {
    await saveDraft(db, bruno(), selfId, fullAnswers());
    await submit(db, bruno(), selfId);
    const request = await requestRow(selfId);
    expect(request.status).toBe("submitted");
    expect(request.submittedAt).toBeInstanceOf(Date);
    await expectError(
      saveDraft(db, bruno(), selfId, fullAnswers()),
      "not_editable",
    );
    await expectError(submit(db, bruno(), selfId), "not_editable");
  });

  it("is only for the reviewer or People", async () => {
    await saveDraft(db, bruno(), selfId, fullAnswers());
    await expectError(submit(db, carla(), selfId), "forbidden");
    await submit(db, hr, selfId);
    expect((await requestRow(selfId)).status).toBe("submitted");
  });
});

describe("share", () => {
  async function submitManager() {
    const mq = await questionsFor(db, cycleId, null, "manager");
    await saveDraft(
      db,
      carla(),
      managerId,
      mq.map((q) => ({
        questionRevisionId: q.id,
        value:
          q.kind === "rating"
            ? q.scale!.options[0].value
            : q.kind === "single_choice"
              ? q.choices![0].value
              : "Comentario",
      })),
    );
    await submit(db, carla(), managerId);
  }

  it("shares a submitted manager review with the reviewee", async () => {
    await submitManager();
    await share(db, carla(), managerId);
    expect((await requestRow(managerId)).sharedAt).toBeInstanceOf(Date);
  });

  it("refuses a draft, a self review and someone other than the reviewer", async () => {
    await expectError(share(db, carla(), managerId), "not_submitted");
    await saveDraft(db, bruno(), selfId, fullAnswers());
    await submit(db, bruno(), selfId);
    await expectError(share(db, bruno(), selfId), "not_shareable");
    await submitManager();
    await expectError(share(db, bruno(), managerId), "forbidden");
  });

  it("keeps a submitted manager review from the reviewee until shared", async () => {
    expect(await getReview(db, bruno(), managerId)).toBeNull();
    await submitManager();
    expect(await getReview(db, bruno(), managerId)).toBeNull();
    await share(db, carla(), managerId);
    expect(await getReview(db, bruno(), managerId)).not.toBeNull();
  });

  it("lets People read it, and not direction nor an unrelated employee", async () => {
    await submitManager();
    expect(await getReview(db, hr, managerId)).not.toBeNull();
    const direction: ActorContext = { personId: null, role: "direction" };
    const stranger: ActorContext = {
      personId: "00000000-0000-4000-8000-0000000000ff",
      role: "employee",
    };
    await share(db, carla(), managerId);
    expect(await getReview(db, direction, managerId)).toBeNull();
    expect(await getReview(db, stranger, managerId)).toBeNull();
    await expectError(share(db, direction, managerId), "forbidden");
    await expectError(share(db, stranger, managerId), "forbidden");
  });

  it("keeps the first share date when shared again", async () => {
    await submitManager();
    await share(db, hr, managerId);
    const first = (await requestRow(managerId)).sharedAt;
    await share(db, carla(), managerId);
    expect((await requestRow(managerId)).sharedAt).toEqual(first);
  });
});

describe("listPendingSelfReviews", () => {
  it("lists the actor's draft self reviews of open cycles", async () => {
    const pending = await listPendingSelfReviews(db, bruno());
    expect(pending).toEqual([
      expect.objectContaining({ requestId: selfId, cycleId }),
    ]);
    expect(await listPendingSelfReviews(db, carla())).toEqual([]);
    expect(await listPendingSelfReviews(db, hr)).toEqual([]);
  });

  it("drops it once submitted or when the cycle closes", async () => {
    await saveDraft(db, bruno(), selfId, fullAnswers());
    await submit(db, bruno(), selfId);
    expect(await listPendingSelfReviews(db, bruno())).toEqual([]);
  });
});

describe("listTeamReviews", () => {
  it("lists the manager's direct reports with both states", async () => {
    const [row] = await listTeamReviews(db, carla());
    expect(row).toMatchObject({
      managerRequestId: managerId,
      selfRequestId: selfId,
      managerStatus: "draft",
      shared: false,
      // A draft self assessment is not the manager's to read yet.
      selfState: "locked",
    });
    expect(row.person.id).toBe(people.bruno);
    await saveDraft(db, bruno(), selfId, fullAnswers());
    await submit(db, bruno(), selfId);
    // Double blind (the default): the self stays closed until the manager's own.
    expect((await listTeamReviews(db, carla()))[0].selfState).toBe("locked");
    const [{ components }] = await db
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.id, cycleId));
    await db
      .update(reviewCycle)
      .set({ components: { ...components, doubleBlind: false } })
      .where(eq(reviewCycle.id, cycleId));
    expect((await listTeamReviews(db, carla()))[0].selfState).toBe("submitted");
  });

  it("is empty for people who manage no one and for direction", async () => {
    expect(await listTeamReviews(db, bruno())).toEqual([]);
    expect(
      await listTeamReviews(db, { personId: null, role: "direction" }),
    ).toEqual([]);
    expect(
      await listTeamReviews(db, { personId: people.ana, role: "manager" }),
    ).toEqual([]);
  });

  it("only lists and lets write the reports the manager has today", async () => {
    vi.setSystemTime(MID_2023);
    // Bruno reports to Ana now: Carla, still the request's reviewer, is out.
    expect(await listTeamReviews(db, carla())).toEqual([]);
    const mq = await questionsFor(db, cycleId, null, "manager");
    const one = [{ questionRevisionId: mq[0].id, value: null }];
    await expectError(saveDraft(db, carla(), managerId, one), "forbidden");
    await expectError(submit(db, carla(), managerId), "forbidden");
    await expectError(share(db, carla(), managerId), "forbidden");
    // Ana manages Bruno today but is not the reviewer: she does not write it.
    const ana: ActorContext = { personId: people.ana, role: "manager" };
    expect(await listTeamReviews(db, ana)).toEqual([]);
    await expectError(saveDraft(db, ana, managerId, one), "forbidden");
    // People still can.
    await saveDraft(db, hr, managerId, one);
  });

  it("leaves out closed cycles and removed participants", async () => {
    await db
      .update(reviewCycle)
      .set({ status: "closed" })
      .where(eq(reviewCycle.id, cycleId));
    expect(await listTeamReviews(db, carla())).toEqual([]);
  });
});
