import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { cycleParticipant, employeeJobHistory, reviewCycle } from "@/db/schema";
import { getCycle, listCycles } from ".";
import {
  createTestCycle,
  loadPeople,
  people,
  resetDb,
  systemTemplateId,
} from "./test-support";

let templateId: string;

beforeAll(async () => {
  templateId = await systemTemplateId();
});
beforeEach(loadPeople);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

const everyone = () => [people.ana, people.bruno, people.carla];

describe("participant snapshots (getCycle)", () => {
  it("freeze each participant's manager and job as of the snapshot date", async () => {
    const { ana, bruno, carla } = people;
    const cycle = await createTestCycle({ templateId, personIds: everyone() });

    // Bruno's manager changes later: the snapshot must not move.
    await db
      .update(employeeJobHistory)
      .set({ managerPersonId: ana, department: "Ventas" })
      .where(
        and(
          eq(employeeJobHistory.personId, bruno),
          eq(employeeJobHistory.validFrom, "2021-07-15"),
        ),
      );

    const detail = await getCycle(db, cycle.id);
    const byId = new Map(
      detail!.participants.map((p) => [p.revieweePersonId, p]),
    );
    expect(byId.get(bruno)).toMatchObject({
      snapManagerPersonId: carla,
      snapManagerName: "Carla Romero",
      snapDepartment: "Ingeniería",
      snapJobTitle: "Developer",
      snapLocation: "Rosario",
      snapshotAsOf: "2022-06-01",
    });
    expect(byId.get(bruno)?.snapJobHistoryId).toBeTruthy();
    expect(byId.get(carla)?.snapManagerPersonId).toBe(ana);
    expect(detail!.questionCount).toBeGreaterThan(0);
  });

  it("keep the snapshot when the referenced job row is deleted", async () => {
    const cycle = await createTestCycle({ templateId, personIds: everyone() });
    // Job-history re-ingest hard-deletes and rebuilds rows.
    await db
      .delete(employeeJobHistory)
      .where(eq(employeeJobHistory.personId, people.bruno));
    const detail = await getCycle(db, cycle.id);
    expect(
      detail!.participants.find((p) => p.revieweePersonId === people.bruno),
    ).toMatchObject({
      snapJobHistoryId: null,
      snapManagerPersonId: people.carla,
      snapJobTitle: "Developer",
    });
  });

  it("flag participants without a manager and count removed ones apart", async () => {
    const cycle = await createTestCycle({ templateId, personIds: everyone() });
    await db
      .update(cycleParticipant)
      .set({ removedAt: new Date() })
      .where(eq(cycleParticipant.revieweePersonId, people.bruno));
    const detail = await getCycle(db, cycle.id);
    const flagged = detail!.participants.filter((p) => p.withoutManager);
    expect(flagged.map((p) => p.revieweePersonId)).toEqual([people.ana]);
    expect(detail!.stats).toEqual({ active: 2, removed: 1, withoutManager: 1 });
  });

  it("is null for an unknown, malformed or deleted cycle", async () => {
    const cycle = await createTestCycle({ personIds: [] });
    await db
      .update(reviewCycle)
      .set({ deletedAt: new Date() })
      .where(eq(reviewCycle.id, cycle.id));
    expect(await getCycle(db, cycle.id)).toBeNull();
    expect(
      await getCycle(db, "00000000-0000-4000-8000-000000000001"),
    ).toBeNull();
    expect(await getCycle(db, "nope")).toBeNull();
  });
});

describe("listCycles", () => {
  it("lists live cycles, newest first, with their active participant count", async () => {
    const first = await createTestCycle({
      name: "H1 2022",
      personIds: everyone(),
    });
    await createTestCycle({ name: "H2 2022", personIds: [people.bruno] });
    await db
      .update(cycleParticipant)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(cycleParticipant.cycleId, first.id),
          eq(cycleParticipant.revieweePersonId, people.ana),
        ),
      );
    const deleted = await createTestCycle({ name: "Old", personIds: [] });
    await db
      .update(reviewCycle)
      .set({ deletedAt: new Date() })
      .where(eq(reviewCycle.id, deleted.id));
    const cycles = await listCycles(db);
    expect(cycles.map((c) => [c.name, c.participantCount])).toEqual([
      ["H2 2022", 1],
      ["H1 2022", 2],
    ]);
  });
});
