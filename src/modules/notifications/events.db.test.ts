import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { notification, reviewCycle } from "@/db/schema";
import {
  addParticipant,
  createCycle,
  findMySelfRequestId,
  launchCycle,
  removeParticipant,
  transition,
} from "@/modules/review-core";
import {
  notifyCalibrationPublished,
  notifyFeedbackReceived,
  notifyPhaseChanged,
  notifyReviewShared,
  unreadCount,
} from ".";
import {
  as,
  collectingCycle,
  cycleInput,
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

beforeEach(async () => {
  await db.delete(reviewCycle);
  await db.delete(notification);
});

const byKind = async (kind: (typeof notification.$inferSelect)["kind"]) =>
  db.select().from(notification).where(eq(notification.kind, kind));

describe("phase changes (hooked into launch and transition)", () => {
  it("tells every participant once per change, with the phases", async () => {
    const cycle = await createCycle(
      db,
      cycleInput(seed, [seed.ana, seed.bruno, seed.carla]),
    );
    await launchCycle(db, cycle.id, null);
    // Launch: draft -> nominations (peer component is on).
    let rows = await byKind("cycle_phase_changed");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      cycleId: cycle.id,
      requestId: null,
      readAt: null,
      payload: {
        cycleName: "H1 2022",
        fromStatus: "draft",
        toStatus: "nominations",
      },
    });

    await transition(db, cycle.id, "collecting", null);
    rows = await byKind("cycle_phase_changed");
    expect(rows).toHaveLength(6);
    expect(await unreadCount(db, as(seed.bruno))).toBe(2);
    const collecting = rows.filter((r) => r.payload.toStatus === "collecting");
    expect(collecting.map((r) => r.recipientPersonId).sort()).toEqual(
      [seed.ana, seed.bruno, seed.carla].sort(),
    );
    expect(collecting[0].payload.fromStatus).toBe("nominations");
  });

  it("notifies again when the cycle goes back to a phase it had already been in", async () => {
    const cycle = await collectingCycle(seed, [seed.bruno]);
    await transition(db, cycle.id, "manager_review", null);
    await transition(db, cycle.id, "collecting", null);
    await transition(db, cycle.id, "manager_review", null);
    const toManagerReview = (await byKind("cycle_phase_changed")).filter(
      (r) => r.payload.toStatus === "manager_review",
    );
    expect(toManagerReview).toHaveLength(2);
  });

  it("leaves out participants who were removed", async () => {
    const cycle = await createCycle(
      db,
      cycleInput(seed, [seed.ana, seed.bruno]),
    );
    await launchCycle(db, cycle.id, null);
    await removeParticipant(db, cycle.id, seed.ana);
    await db.delete(notification);
    await transition(db, cycle.id, "collecting", null);
    const rows = await byKind("cycle_phase_changed");
    expect(rows.map((r) => r.recipientPersonId)).toEqual([seed.bruno]);
  });

  it("a rejected transition notifies nobody", async () => {
    const cycle = await collectingCycle(seed, [seed.bruno]);
    await db.delete(notification);
    await expect(transition(db, cycle.id, "closed", null)).rejects.toThrow();
    expect(await byKind("cycle_phase_changed")).toHaveLength(0);
  });

  it("is idempotent for the same transition", async () => {
    const cycle = await collectingCycle(seed, [seed.bruno]);
    await db.delete(notification);
    await notifyPhaseChanged(db, cycle.id, "nominations", "collecting");
    await notifyPhaseChanged(db, cycle.id, "nominations", "collecting");
    expect(await byKind("cycle_phase_changed")).toHaveLength(1);
  });

  it("includes people added mid-cycle", async () => {
    const cycle = await collectingCycle(seed, [seed.bruno]);
    await addParticipant(db, cycle.id, seed.carla, "2022-06-10");
    await db.delete(notification);
    await transition(db, cycle.id, "manager_review", null);
    const rows = await byKind("cycle_phase_changed");
    expect(rows.map((r) => r.recipientPersonId).sort()).toEqual(
      [seed.bruno, seed.carla].sort(),
    );
  });
});

describe("event notifications for the sharing, feedback and calibration slices", () => {
  it("notifyReviewShared tells the reviewee their review was shared, once", async () => {
    const cycle = await collectingCycle(seed, [seed.bruno]);
    await db.delete(notification);
    const requestId = (await findMySelfRequestId(
      db,
      as(seed.bruno),
      cycle.id,
    ))!;
    const input = {
      cycleId: cycle.id,
      requestId,
      recipientPersonId: seed.bruno,
      senderName: "Carla Romero",
    };
    expect(await notifyReviewShared(db, input)).toBe(true);
    expect(await notifyReviewShared(db, input)).toBe(false);
    const [row] = await byKind("review_shared");
    expect(row).toMatchObject({
      recipientPersonId: seed.bruno,
      cycleId: cycle.id,
      requestId,
      payload: { cycleName: "H1 2022", senderName: "Carla Romero" },
    });
  });

  it("notifyFeedbackReceived never carries the author", async () => {
    const cycle = await collectingCycle(seed, [seed.bruno]);
    await db.delete(notification);
    const requestId = (await findMySelfRequestId(
      db,
      as(seed.bruno),
      cycle.id,
    ))!;
    expect(
      await notifyFeedbackReceived(db, {
        cycleId: cycle.id,
        requestId,
        recipientPersonId: seed.carla,
      }),
    ).toBe(true);
    const [row] = await byKind("feedback_received");
    expect(row.payload).toEqual({ cycleName: "H1 2022" });
  });

  it("notifyCalibrationPublished tells each recipient once and counts new ones", async () => {
    const cycle = await collectingCycle(seed, [seed.bruno]);
    await db.delete(notification);
    expect(
      await notifyCalibrationPublished(db, {
        cycleId: cycle.id,
        recipientPersonIds: [seed.ana, seed.carla, seed.ana],
      }),
    ).toBe(2);
    expect(
      await notifyCalibrationPublished(db, {
        cycleId: cycle.id,
        recipientPersonIds: [seed.ana, seed.carla, seed.bruno],
      }),
    ).toBe(1);
    expect(await byKind("calibration_published")).toHaveLength(3);
    expect(
      await db
        .select()
        .from(notification)
        .where(
          and(
            eq(notification.kind, "calibration_published"),
            eq(notification.recipientPersonId, seed.ana),
          ),
        ),
    ).toHaveLength(1);
  });

  it("returns 0 and creates nothing for an unknown cycle", async () => {
    expect(
      await notifyCalibrationPublished(db, {
        cycleId: "00000000-0000-4000-8000-000000000000",
        recipientPersonIds: [seed.ana],
      }),
    ).toBe(0);
  });
});
