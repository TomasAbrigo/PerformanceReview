import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  notification,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import { addDays, todayLocal } from "@/modules/org-history/dates";
import {
  findMySelfRequestId,
  listMyTasks,
  removeParticipant,
  transition,
} from "@/modules/review-core";
import { generateDueReminders, NotificationError, remind } from ".";
import {
  as,
  collectingCycle,
  hr,
  resetAll,
  seedPeople,
  type Seed,
} from "./test-support";

let seed: Seed;

beforeAll(async () => {
  await resetAll();
  seed = await seedPeople();
});

afterAll(async () => {
  await resetAll();
  await closeDb();
});

/** Every cycle is deleted between tests, and the notifications with them. */
beforeEach(async () => {
  await db.delete(reviewCycle);
  await db.delete(notification);
});

const all = () => db.select().from(notification);
const reminders = async () =>
  (await all()).filter((n) => n.kind === "reminder_due");

/** A cycle in collecting with Ana, Bruno and Carla, due 2022-07-15 (self). */
const trio = () =>
  collectingCycle(seed, [seed.ana, seed.bruno, seed.carla]).then(async (c) => {
    // Launch and phase events are not what these tests are about.
    await db.delete(notification);
    return c;
  });

describe("generateDueReminders", () => {
  it("reminds everyone with a pending self assessment 7 days before the due date", async () => {
    const cycle = await trio();
    const result = await generateDueReminders(db, { asOf: "2022-07-08" });
    expect(result).toMatchObject({ asOf: "2022-07-08", created: 3 });
    const rows = await reminders();
    expect(rows.map((r) => r.recipientPersonId).sort()).toEqual(
      [seed.ana, seed.bruno, seed.carla].sort(),
    );
    const bruno = rows.find((r) => r.recipientPersonId === seed.bruno)!;
    expect(bruno).toMatchObject({
      cycleId: cycle.id,
      readAt: null,
      payload: {
        cycleName: "H1 2022",
        dueDate: "2022-07-15",
        daysLeft: 7,
        relationship: "self",
      },
    });
    expect(bruno.requestId).toBe(
      await findMySelfRequestId(db, as(seed.bruno), cycle.id),
    );
  });

  it("running it twice the same day creates no duplicates", async () => {
    await trio();
    const first = await generateDueReminders(db, { asOf: "2022-07-08" });
    const second = await generateDueReminders(db, { asOf: "2022-07-08" });
    expect(first.created).toBe(3);
    expect(second).toMatchObject({ created: 0, candidates: 3 });
    expect(await reminders()).toHaveLength(3);
  });

  it("computes 7, 1 and 0 days against the date it runs for", async () => {
    await trio();
    const created = async (asOf: string) =>
      (await generateDueReminders(db, { asOf })).created;
    expect(await created("2022-07-07")).toBe(0); // 8 days
    expect(await created("2022-07-09")).toBe(0); // 6 days
    expect(await created("2022-07-13")).toBe(0); // 2 days
    expect(await created("2022-07-16")).toBe(0); // overdue: no nagging
    expect(await created("2022-07-08")).toBe(3);
    expect(await created("2022-07-14")).toBe(3);
    expect(await created("2022-07-15")).toBe(3);
    const days = (await reminders()).map((r) => r.payload.daysLeft);
    expect(days.filter((d) => d === 7)).toHaveLength(3);
    expect(days.filter((d) => d === 1)).toHaveLength(3);
    expect(days.filter((d) => d === 0)).toHaveLength(3);
  });

  it("takes the offsets as an option", async () => {
    await trio();
    expect(
      (await generateDueReminders(db, { asOf: "2022-07-12", offsets: [3] }))
        .created,
    ).toBe(3);
    expect(
      (await generateDueReminders(db, { asOf: "2022-07-08", offsets: [3] }))
        .created,
    ).toBe(0);
  });

  it("defaults to today in the company time zone", async () => {
    await collectingCycle(seed, [seed.bruno], {
      dueDates: { self: addDays(todayLocal(), 7) },
    });
    await db.delete(notification);
    const result = await generateDueReminders(db);
    expect(result).toMatchObject({ asOf: todayLocal(), created: 1 });
    expect((await reminders())[0].payload.daysLeft).toBe(7);
  });

  it("only reminds people whose task is still pending", async () => {
    const cycle = await trio();
    // Bruno submitted, Ana declined, Carla was removed from the cycle.
    await db
      .update(reviewRequest)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(
        and(
          eq(reviewRequest.cycleId, cycle.id),
          eq(reviewRequest.reviewerPersonId, seed.bruno),
        ),
      );
    await db
      .update(reviewRequest)
      .set({ status: "declined", declinedAt: new Date() })
      .where(
        and(
          eq(reviewRequest.cycleId, cycle.id),
          eq(reviewRequest.reviewerPersonId, seed.ana),
        ),
      );
    await removeParticipant(db, cycle.id, seed.carla);
    const result = await generateDueReminders(db, { asOf: "2022-07-08" });
    expect(result.created).toBe(0);
    expect(await reminders()).toHaveLength(0);
  });

  it("reminds exactly the people who have the task in their inbox", async () => {
    const cycle = await trio();
    await db
      .update(reviewRequest)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(
        and(
          eq(reviewRequest.cycleId, cycle.id),
          eq(reviewRequest.reviewerPersonId, seed.bruno),
        ),
      );
    await generateDueReminders(db, { asOf: "2022-07-08" });
    const withTask: string[] = [];
    for (const id of [seed.ana, seed.bruno, seed.carla]) {
      const tasks = await listMyTasks(db, as(id));
      if (tasks.selfAssessments.length > 0) withTask.push(id);
    }
    expect((await reminders()).map((r) => r.recipientPersonId).sort()).toEqual(
      withTask.sort(),
    );
    expect(withTask).not.toContain(seed.bruno);
  });

  it("skips closed and deleted cycles and cycles that left the phase", async () => {
    const closed = await trio();
    await db
      .update(reviewCycle)
      .set({ status: "closed" })
      .where(eq(reviewCycle.id, closed.id));
    expect(
      (await generateDueReminders(db, { asOf: "2022-07-08" })).created,
    ).toBe(0);

    await db
      .update(reviewCycle)
      .set({ status: "collecting", deletedAt: new Date() })
      .where(eq(reviewCycle.id, closed.id));
    expect(
      (await generateDueReminders(db, { asOf: "2022-07-08" })).created,
    ).toBe(0);
  });

  it("the 7 and 1 day reminders only need a live cycle; the due-day one needs the review to be writable", async () => {
    const cycle = await trio();
    // Self assessments cannot be written once the cycle left collecting...
    await transition(db, cycle.id, "manager_review", null);
    const created = async (asOf: string) =>
      (await generateDueReminders(db, { asOf })).created;
    // ...but the people who have not submitted are still reminded ahead of
    // the deadline (the phase may come back, or HR may unlock them),
    expect(await created("2022-07-08")).toBe(3);
    expect(await created("2022-07-14")).toBe(3);
    // while nobody is told "due today" about something they cannot write.
    expect(await created("2022-07-15")).toBe(0);
  });

  it("skips cycles with no due date for the phase", async () => {
    await collectingCycle(seed, [seed.bruno], { dueDates: {} });
    expect(
      (await generateDueReminders(db, { asOf: "2022-07-08" })).created,
    ).toBe(0);
  });

  it("reminds again when the due date moves to a new day that is 7 days away", async () => {
    const cycle = await trio();
    await generateDueReminders(db, { asOf: "2022-07-08" });
    await db
      .update(reviewCycle)
      .set({ dueDates: { self: "2022-07-20" } })
      .where(eq(reviewCycle.id, cycle.id));
    expect(
      (await generateDueReminders(db, { asOf: "2022-07-13" })).created,
    ).toBe(3);
    expect(await reminders()).toHaveLength(6);
  });

  it("uses each kind of review's own due date and names the reviewee", async () => {
    const cycle = await trio();
    await db
      .update(reviewCycle)
      .set({
        dueDates: {
          self: "2022-07-15",
          manager: "2022-08-01",
          peer: "2022-07-22",
        },
      })
      .where(eq(reviewCycle.id, cycle.id));
    const [carlaPart] = await db
      .select()
      .from(cycleParticipant)
      .where(
        and(
          eq(cycleParticipant.cycleId, cycle.id),
          eq(cycleParticipant.revieweePersonId, seed.carla),
        ),
      );
    // Bruno gives peer feedback to Carla. The manager requests (Carla reviews
    // Bruno, Ana reviews Carla, Ana has no manager) came with collecting.
    await db.insert(reviewRequest).values({
      cycleId: cycle.id,
      participantId: carlaPart.id,
      reviewerPersonId: seed.bruno,
      relationship: "peer",
    });

    // 7 days before the manager due date: only the manager requests are due,
    // and the one without a reviewer is skipped.
    expect(
      (await generateDueReminders(db, { asOf: "2022-07-25" })).created,
    ).toBe(2);
    const managers = await reminders();
    expect(
      managers
        .map((r) => [r.recipientPersonId, r.payload])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual(
      [
        [
          seed.carla,
          {
            cycleName: "H1 2022",
            relationship: "manager",
            dueDate: "2022-08-01",
            participantName: "Bruno Pérez",
            daysLeft: 7,
          },
        ],
        [
          seed.ana,
          {
            cycleName: "H1 2022",
            relationship: "manager",
            dueDate: "2022-08-01",
            participantName: "Carla Romero",
            daysLeft: 7,
          },
        ],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    // The peer request follows the peer due date (7 days before 07-22).
    expect(
      (await generateDueReminders(db, { asOf: "2022-07-15" })).created,
    ).toBe(4); // 3 self assessments due today + the peer one
    const peer = (await reminders()).find(
      (r) => r.payload.relationship === "peer",
    );
    expect(peer).toMatchObject({
      recipientPersonId: seed.bruno,
      payload: {
        dueDate: "2022-07-22",
        participantName: "Carla Romero",
        daysLeft: 7,
      },
    });
  });
});

describe("remind (manual reminder)", () => {
  const brunoRequest = async (cycleId: string) =>
    (await findMySelfRequestId(db, as(seed.bruno), cycleId))!;

  const manualReminders = async () =>
    (await all()).filter((n) => n.kind === "manual_reminder");

  it("lets the participant's snapshot manager remind the reviewer", async () => {
    // Bruno reported to Carla on the snapshot date (2022-06-01).
    const cycle = await trio();
    const requestId = await brunoRequest(cycle.id);
    const result = await remind(db, as(seed.carla, "manager"), requestId, {
      asOf: "2022-07-08",
    });
    expect(result).toEqual({ created: true });
    const [row] = await manualReminders();
    expect(row).toMatchObject({
      recipientPersonId: seed.bruno,
      cycleId: cycle.id,
      requestId,
      readAt: null,
      payload: {
        cycleName: "H1 2022",
        dueDate: "2022-07-15",
        relationship: "self",
        senderName: "Carla Romero",
      },
    });
  });

  it("lets HR remind, with or without a person", async () => {
    const cycle = await trio();
    const requestId = await brunoRequest(cycle.id);
    expect(
      (await remind(db, hr, requestId, { asOf: "2022-07-08" })).created,
    ).toBe(true);
    expect(
      (await remind(db, as(seed.ana, "hr"), requestId, { asOf: "2022-07-08" }))
        .created,
    ).toBe(true);
    const rows = await manualReminders();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.payload.senderName ?? null).sort()).toEqual([
      "Ana García",
      null,
    ]);
  });

  it("forbids everybody else", async () => {
    const cycle = await trio();
    const requestId = await brunoRequest(cycle.id);
    for (const actor of [
      as(seed.ana, "manager"), // Carla's manager, not Bruno's
      as(seed.bruno, "employee"), // the reviewer himself
      { personId: null, role: "employee" as const },
    ]) {
      await expect(remind(db, actor, requestId)).rejects.toMatchObject({
        code: "forbidden",
        name: "NotificationError",
      });
    }
    expect(await manualReminders()).toHaveLength(0);
  });

  it("is not found for unknown ids", async () => {
    await trio();
    await expect(remind(db, hr, "nope")).rejects.toBeInstanceOf(
      NotificationError,
    );
    await expect(
      remind(db, hr, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("only reminds about pending tasks", async () => {
    const cycle = await trio();
    const requestId = await brunoRequest(cycle.id);
    await db
      .update(reviewRequest)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(eq(reviewRequest.id, requestId));
    await expect(remind(db, hr, requestId)).rejects.toMatchObject({
      code: "not_pending",
    });
    await db
      .update(reviewRequest)
      .set({ status: "draft", submittedAt: null })
      .where(eq(reviewRequest.id, requestId));
    await removeParticipant(db, cycle.id, seed.bruno);
    await expect(remind(db, hr, requestId)).rejects.toMatchObject({
      code: "not_pending",
    });
    expect(await manualReminders()).toHaveLength(0);
  });

  it("reminds in any live phase, not only while the review is writable", async () => {
    const cycle = await trio();
    const requestId = await brunoRequest(cycle.id);
    await transition(db, cycle.id, "manager_review", null);
    expect(await remind(db, hr, requestId, { asOf: "2022-07-08" })).toEqual({
      created: true,
    });
  });

  it("does not remind in a closed cycle", async () => {
    const cycle = await trio();
    const requestId = await brunoRequest(cycle.id);
    await db
      .update(reviewCycle)
      .set({ status: "closed" })
      .where(eq(reviewCycle.id, cycle.id));
    await expect(remind(db, hr, requestId)).rejects.toMatchObject({
      code: "not_pending",
    });
  });

  it("sends one per sender and request each day", async () => {
    const cycle = await trio();
    const requestId = await brunoRequest(cycle.id);
    const carla = as(seed.carla, "manager");
    expect(await remind(db, carla, requestId, { asOf: "2022-07-08" })).toEqual({
      created: true,
    });
    expect(await remind(db, carla, requestId, { asOf: "2022-07-08" })).toEqual({
      created: false,
    });
    // Another day, or another sender, is a new reminder.
    expect(await remind(db, carla, requestId, { asOf: "2022-07-09" })).toEqual({
      created: true,
    });
    expect(await remind(db, hr, requestId, { asOf: "2022-07-09" })).toEqual({
      created: true,
    });
    expect(await manualReminders()).toHaveLength(3);
  });

  it("does not mix with the automatic reminders", async () => {
    const cycle = await trio();
    const requestId = await brunoRequest(cycle.id);
    await generateDueReminders(db, { asOf: "2022-07-08" });
    await remind(db, hr, requestId, { asOf: "2022-07-08" });
    expect(await reminders()).toHaveLength(3);
    expect(await manualReminders()).toHaveLength(1);
  });
});
