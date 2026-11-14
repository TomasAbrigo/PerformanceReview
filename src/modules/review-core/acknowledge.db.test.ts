import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { cycleParticipant, reviewRequest } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  ACK_NOTE_MAX_LENGTH,
  acknowledge,
  AckError,
  getAcknowledgement,
  listMyTasks,
  removeParticipant,
  shareReview,
  unshare,
} from ".";
import {
  as,
  collectingCycle,
  hr,
  loadPeople,
  outsider,
  people,
  resetDb,
  sharedCycle,
  submitManager,
  submitSelf,
  systemTemplateId,
  toSharing,
} from "./compare-ack.fixtures";

let templateId: string;

beforeAll(async () => {
  templateId = await systemTemplateId();
});
beforeEach(loadPeople);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

const DAY = 24 * 60 * 60 * 1000;
const bruno = () => as(people.bruno);

const stored = async (participantId: string) =>
  (
    await db
      .select()
      .from(cycleParticipant)
      .where(eq(cycleParticipant.id, participantId))
  )[0];

describe("acknowledge", () => {
  it("records the date and the optional note once the review is shared", async () => {
    const { participantId } = await sharedCycle(templateId);
    const before = Date.now();
    const state = await acknowledge(
      db,
      bruno(),
      participantId,
      "  Gracias, lo leí.  ",
    );
    expect(state.status).toBe("acknowledged");
    expect(state.note).toBe("Gracias, lo leí.");
    expect(state.acknowledgedAt!.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );

    const row = await stored(participantId);
    expect(row.acknowledgedAt).toEqual(state.acknowledgedAt);
    expect(row.acknowledgementNote).toBe("Gracias, lo leí.");
  });

  it("the note is optional", async () => {
    const { participantId } = await sharedCycle(templateId);
    await acknowledge(db, bruno(), participantId);
    const row = await stored(participantId);
    expect(row.acknowledgedAt).not.toBeNull();
    expect(row.acknowledgementNote).toBeNull();
  });

  it("blank notes are stored as no note; very long ones are refused", async () => {
    const { participantId } = await sharedCycle(templateId);
    await expect(
      acknowledge(db, bruno(), participantId, "x".repeat(2001)),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "note", message: "too_long" }],
    });
    expect((await stored(participantId)).acknowledgedAt).toBeNull();
    await acknowledge(db, bruno(), participantId, "   ");
    expect((await stored(participantId)).acknowledgementNote).toBeNull();
  });

  it("is refused before the manager review is shared", async () => {
    const cycle = await collectingCycle(templateId);
    await submitSelf(cycle.id);
    const { participantId } = await submitManager(cycle.id);
    await expect(acknowledge(db, bruno(), participantId)).rejects.toMatchObject(
      { code: "not_shared" },
    );
    expect((await stored(participantId)).acknowledgedAt).toBeNull();
  });

  it("is refused again if People hides the review", async () => {
    const { participantId, requestId } = await sharedCycle(templateId);
    await unshare(db, hr, requestId);
    await expect(acknowledge(db, bruno(), participantId)).rejects.toMatchObject(
      { code: "not_shared" },
    );
  });

  it("can be done only once and stays as it was", async () => {
    const { participantId } = await sharedCycle(templateId);
    const first = await acknowledge(db, bruno(), participantId, "Primera");
    await expect(
      acknowledge(db, bruno(), participantId, "Segunda"),
    ).rejects.toMatchObject({ code: "already_acknowledged" });
    const row = await stored(participantId);
    expect(row.acknowledgedAt).toEqual(first.acknowledgedAt);
    expect(row.acknowledgementNote).toBe("Primera");
  });

  it("two concurrent attempts record exactly one", async () => {
    const { participantId } = await sharedCycle(templateId);
    const results = await Promise.allSettled([
      acknowledge(db, bruno(), participantId, "A"),
      acknowledge(db, bruno(), participantId, "B"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as
      PromiseRejectedResult | undefined;
    expect(failed?.reason).toBeInstanceOf(AckError);
    expect(failed?.reason.code).toBe("already_acknowledged");
  });

  it("only the reviewee acknowledges (not their manager, People or others)", async () => {
    const { participantId } = await sharedCycle(templateId);
    for (const actor of [
      as(people.carla, "manager"),
      as(people.ana, "manager"),
      hr,
      outsider(),
    ]) {
      await expect(acknowledge(db, actor, participantId)).rejects.toMatchObject(
        { code: "forbidden" },
      );
    }
    expect((await stored(participantId)).acknowledgedAt).toBeNull();
  });

  it("defaults to 7 days after sharing, configurable", async () => {
    const { participantId, requestId } = await sharedCycle(templateId);
    const { managerShared } = await sharedAt(requestId);
    const edge = new Date(managerShared.getTime() + 7 * DAY);
    const late = new Date(edge.getTime() + 1000);
    await expect(
      acknowledge(db, bruno(), participantId, null, { now: late }),
    ).rejects.toMatchObject({ code: "window_closed" });
    expect((await stored(participantId)).acknowledgedAt).toBeNull();
    // Configurable window: 10 days still allows it.
    const state = await acknowledge(db, bruno(), participantId, null, {
      now: late,
      windowDays: 10,
    });
    expect(state.status).toBe("acknowledged");
  });

  it("accepts the last instant of the window", async () => {
    const { participantId, requestId } = await sharedCycle(templateId);
    const { managerShared } = await sharedAt(requestId);
    const state = await acknowledge(db, bruno(), participantId, null, {
      now: new Date(managerShared.getTime() + 7 * DAY),
    });
    expect(state.status).toBe("acknowledged");
  });

  it("uses the cycle's acknowledge due date when it has one", async () => {
    const open = await sharedCycle(templateId, {
      dueDates: { self: "2022-07-15", acknowledge: "2099-01-01" },
    });
    // Way past 7 days after sharing, but before the due date.
    const state = await acknowledge(db, bruno(), open.participantId, null, {
      now: new Date(Date.now() + 365 * DAY),
    });
    expect(state.status).toBe("acknowledged");
    expect(state.deadline).toEqual(new Date("2099-01-01T23:59:59.999Z"));
  });

  it("a review shared after the acknowledge due date still gets the default window", async () => {
    const { participantId, requestId } = await sharedCycle(templateId, {
      dueDates: { self: "2022-07-15", acknowledge: "2022-08-01" },
    });
    const { managerShared } = await sharedAt(requestId);
    const before = await getAcknowledgement(db, bruno(), participantId);
    expect(before.status).toBe("open");
    expect(before.deadline).toEqual(
      new Date(managerShared.getTime() + 7 * DAY),
    );
    expect((await listMyTasks(db, bruno())).acknowledgements).toHaveLength(1);
    const state = await acknowledge(
      db,
      bruno(),
      participantId,
      "Tarde pero a tiempo",
    );
    expect(state.status).toBe("acknowledged");
  });

  it("the participant's own acknowledge date (#21) is used before the cycle's", async () => {
    const { participantId } = await sharedCycle(templateId, {
      dueDates: { self: "2022-07-15", acknowledge: "2022-08-01" },
    });
    await db
      .update(cycleParticipant)
      .set({ dueDates: { acknowledge: "2099-01-01" } })
      .where(eq(cycleParticipant.id, participantId));
    const state = await getAcknowledgement(db, bruno(), participantId);
    expect(state.deadline).toEqual(new Date("2099-01-01T23:59:59.999Z"));
    const [task] = (await listMyTasks(db, bruno())).acknowledgements;
    expect(task.deadline).toEqual(new Date("2099-01-01T23:59:59.999Z"));
  });

  it("checks the state before validating the note", async () => {
    const tooLong = "x".repeat(ACK_NOTE_MAX_LENGTH + 1);
    const cycle = await collectingCycle(templateId);
    await submitSelf(cycle.id);
    const { participantId, requestId } = await submitManager(cycle.id);
    await expect(
      acknowledge(db, bruno(), participantId, tooLong),
    ).rejects.toMatchObject({ code: "not_shared" });
    await toSharing(cycle.id);
    await shareReview(db, as(people.carla), requestId);
    const { managerShared } = await sharedAt(requestId);
    await expect(
      acknowledge(db, bruno(), participantId, tooLong, {
        now: new Date(managerShared.getTime() + 8 * DAY),
      }),
    ).rejects.toMatchObject({ code: "window_closed" });
    await expect(
      acknowledge(db, bruno(), participantId, tooLong),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("a removed participant cannot acknowledge", async () => {
    const { cycle, participantId } = await sharedCycle(templateId);
    await removeParticipant(db, cycle.id, people.bruno);
    await expect(acknowledge(db, bruno(), participantId)).rejects.toMatchObject(
      { code: "forbidden" },
    );
    expect(await ackTasks(bruno())).toEqual([]);
    expect((await stored(participantId)).acknowledgedAt).toBeNull();
  });

  it("not_found for an unknown participant", async () => {
    await expect(
      acknowledge(db, bruno(), "00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(acknowledge(db, bruno(), "x")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("the database refuses a note without a date", async () => {
    const { participantId } = await sharedCycle(templateId);
    await expect(
      db
        .update(cycleParticipant)
        .set({ acknowledgementNote: "suelta" })
        .where(eq(cycleParticipant.id, participantId)),
    ).rejects.toThrow();
  });
});

/** The shared_at of a request as stored. */
async function sharedAt(requestId: string) {
  const [row] = await db
    .select({ sharedAt: reviewRequest.sharedAt })
    .from(reviewRequest)
    .where(eq(reviewRequest.id, requestId));
  return { managerShared: row.sharedAt! };
}

describe("getAcknowledgement", () => {
  it("reports the state to the employee, their manager and HR", async () => {
    const cycle = await collectingCycle(templateId);
    await submitSelf(cycle.id);
    const { participantId, requestId } = await submitManager(cycle.id);
    for (const actor of [bruno(), as(people.carla, "manager"), hr]) {
      expect((await getAcknowledgement(db, actor, participantId)).status).toBe(
        "not_shared",
      );
    }
    await toSharing(cycle.id);
    await shareReview(db, as(people.carla), requestId);
    const open = await getAcknowledgement(db, bruno(), participantId);
    expect(open.status).toBe("open");
    expect(open.deadline).not.toBeNull();

    await acknowledge(db, bruno(), participantId, "Hecho");
    const seenByManager = await getAcknowledgement(
      db,
      as(people.carla, "manager"),
      participantId,
    );
    expect(seenByManager).toMatchObject({
      status: "acknowledged",
      note: "Hecho",
    });
    await expect(
      getAcknowledgement(db, outsider(), participantId),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      getAcknowledgement(db, as(people.ana, "manager"), participantId),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reports an expired window", async () => {
    const { participantId } = await sharedCycle(templateId);
    const state = await getAcknowledgement(db, bruno(), participantId, {
      now: new Date(Date.now() + 8 * DAY),
    });
    expect(state.status).toBe("expired");
  });
});

/** The /me "Acusar recibo" tasks. */
const ackTasks = async (actor: ActorContext, options?: { now?: Date }) =>
  (await listMyTasks(db, actor, options)).acknowledgements;

describe("the /me acknowledge tasks (listMyTasks)", () => {
  it("lists shared reviews still to acknowledge, until acknowledged or expired", async () => {
    const cycle = await collectingCycle(templateId);
    await submitSelf(cycle.id);
    const { participantId, requestId } = await submitManager(cycle.id);
    expect(await ackTasks(bruno())).toEqual([]);

    await toSharing(cycle.id);
    await shareReview(db, as(people.carla), requestId);
    const tasks = await ackTasks(bruno());
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      participantId,
      cycleId: cycle.id,
      cycleName: "H1 2022",
    });
    expect(tasks[0].deadline.getTime()).toBeGreaterThan(Date.now());

    // Nobody else has this task.
    expect(await ackTasks(as(people.carla))).toEqual([]);
    expect(await ackTasks(hr)).toEqual([]);

    expect(
      await ackTasks(bruno(), {
        now: new Date(Date.now() + 8 * DAY),
      }),
    ).toEqual([]);

    await acknowledge(db, bruno(), participantId);
    expect(await ackTasks(bruno())).toEqual([]);
  });
});
