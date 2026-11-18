import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  questionRevision,
  reviewRequest,
  reviewTemplate,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  addParticipant,
  assertCycleOpen,
  closeCycle,
  createCycle,
  cycleProgress,
  getCycle,
  launchCycle,
  listCandidates,
  listCycleRequests,
  removeParticipant,
  reopenRequest,
  setParticipants,
} from ".";
import { loadPeople, people, resetDb, systemTemplateId } from "./test-support";

const hr: ActorContext = { personId: null, role: "hr" };
const manager = (personId: string): ActorContext => ({
  personId,
  role: "manager",
});

let templateId: string;
beforeAll(async () => {
  await systemTemplateId();
  [{ id: templateId }] = await db
    .select({ id: reviewTemplate.id })
    .from(reviewTemplate)
    .where(eq(reviewTemplate.systemKey, "santex_semester"));
});
beforeEach(loadPeople);
afterAll(async () => {
  await resetDb();
  await closeDb();
});

const input = (extra: Partial<Parameters<typeof createCycle>[2]> = {}) => ({
  name: "Evaluación semestral 2025-H1",
  periodStart: "2022-01-01",
  periodEnd: "2022-06-30",
  ...extra,
});

const requestsOf = (cycleId: string) =>
  db.select().from(reviewRequest).where(eq(reviewRequest.cycleId, cycleId));

const selfRequestOf = async (cycleId: string, personId: string) =>
  (
    await db
      .select()
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.cycleId, cycleId),
          eq(reviewRequest.relationship, "self"),
          eq(reviewRequest.reviewerPersonId, personId),
        ),
      )
  )[0];

describe("createCycle", () => {
  it("creates a draft native cycle on the Santex template by default", async () => {
    const cycle = await createCycle(db, hr, input());
    expect(cycle).toMatchObject({
      status: "draft",
      sourceSystem: "native",
      templateId,
      periodStart: "2022-01-01",
      periodEnd: "2022-06-30",
    });
    expect(cycle.components).toMatchObject({ self: true, manager: true });
  });

  it("rejects an empty name and an inverted period", async () => {
    await expect(
      createCycle(db, hr, input({ name: " " })),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      createCycle(
        db,
        hr,
        input({ periodStart: "2022-07-01", periodEnd: "2022-06-30" }),
      ),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("is forbidden for anyone but People", async () => {
    for (const actor of [
      manager(people.carla),
      { personId: people.ana, role: "employee" as const },
      { personId: null, role: "direction" as const },
    ]) {
      await expect(createCycle(db, actor, input())).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });
});

describe("participants and launch", () => {
  it("lists active people as candidates", async () => {
    const candidates = await listCandidates(db, hr, "2022-06-01");
    // Carla is inactive in the fixtures: she is not offered.
    expect(candidates.map((c) => c.personId).sort()).toEqual(
      [people.ana, people.bruno].sort(),
    );
    expect(candidates.find((c) => c.personId === people.bruno)).toMatchObject({
      displayName: "Bruno Pérez",
      managerName: "Carla Romero",
    });
  });

  it("shows who has no manager before opening", async () => {
    const cycle = await createCycle(db, hr, input());
    await setParticipants(db, hr, cycle.id, [people.ana, people.bruno]);
    const detail = await getCycle(db, cycle.id);
    expect(
      detail!.participants
        .filter((p) => p.withoutManager)
        .map((p) => p.revieweePersonId),
    ).toEqual([people.ana]);
  });

  it("opens the cycle: a self and a manager request per participant", async () => {
    const cycle = await createCycle(db, hr, input());
    await setParticipants(db, hr, cycle.id, [
      people.ana,
      people.bruno,
      people.carla,
    ]);
    const opened = await launchCycle(db, hr, cycle.id);
    expect(opened.status).toBe("collecting");
    expect(opened.launchedAt).not.toBeNull();

    const requests = await requestsOf(cycle.id);
    expect(requests).toHaveLength(6);
    expect(requests.every((r) => r.sourceSystem === "native")).toBe(true);
    expect(requests.every((r) => r.status === "draft")).toBe(true);

    const participantOf = async (personId: string) =>
      (
        await db
          .select()
          .from(cycleParticipant)
          .where(eq(cycleParticipant.revieweePersonId, personId))
      )[0];
    const bruno = await participantOf(people.bruno);
    const of = (participantId: string, rel: string) =>
      requests.find(
        (r) => r.participantId === participantId && r.relationship === rel,
      )!;
    expect(of(bruno.id, "self").reviewerPersonId).toBe(people.bruno);
    expect(of(bruno.id, "manager")).toMatchObject({
      reviewerPersonId: people.carla,
      reviewerMissing: false,
    });
    expect(bruno.snapManagerPersonId).toBe(people.carla);

    const ana = await participantOf(people.ana);
    expect(of(ana.id, "manager")).toMatchObject({
      reviewerPersonId: null,
      reviewerMissing: true,
    });

    const revisions = await db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.cycleId, cycle.id));
    expect(revisions.length).toBeGreaterThan(0);
  });

  it("refuses to open without participants or twice", async () => {
    const cycle = await createCycle(db, hr, input());
    await expect(launchCycle(db, hr, cycle.id)).rejects.toMatchObject({
      code: "validation",
    });
    await setParticipants(db, hr, cycle.id, [people.bruno]);
    await launchCycle(db, hr, cycle.id);
    await expect(launchCycle(db, hr, cycle.id)).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("only People may set participants and open", async () => {
    const cycle = await createCycle(db, hr, input());
    const actor = manager(people.carla);
    await expect(
      setParticipants(db, actor, cycle.id, [people.bruno]),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(launchCycle(db, actor, cycle.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("adds and removes participants on an open cycle", async () => {
    const cycle = await createCycle(db, hr, input());
    await setParticipants(db, hr, cycle.id, [people.bruno]);
    await launchCycle(db, hr, cycle.id);

    await addParticipant(db, hr, cycle.id, people.carla);
    expect(await requestsOf(cycle.id)).toHaveLength(4);
    // Adding again changes nothing.
    await addParticipant(db, hr, cycle.id, people.carla);
    expect(await requestsOf(cycle.id)).toHaveLength(4);

    await removeParticipant(db, hr, cycle.id, people.bruno);
    const detail = await getCycle(db, cycle.id);
    expect(detail!.stats.active).toBe(1);
    expect(detail!.stats.removed).toBe(1);

    // Bringing them back reuses the same requests.
    await addParticipant(db, hr, cycle.id, people.bruno);
    expect((await getCycle(db, cycle.id))!.stats.active).toBe(2);
    expect(await requestsOf(cycle.id)).toHaveLength(4);
  });
});

describe("close, reopen and progress", () => {
  async function opened() {
    const cycle = await createCycle(db, hr, input());
    await setParticipants(db, hr, cycle.id, [people.bruno, people.carla]);
    await launchCycle(db, hr, cycle.id);
    return cycle;
  }

  it("a closed cycle rejects submissions", async () => {
    const cycle = await opened();
    await expect(assertCycleOpen(db, cycle.id)).resolves.toBeUndefined();
    const closed = await closeCycle(db, hr, cycle.id);
    expect(closed.status).toBe("closed");
    await expect(assertCycleOpen(db, cycle.id)).rejects.toMatchObject({
      code: "invalid_state",
    });
    await expect(closeCycle(db, hr, cycle.id)).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("reopens a submitted request as a draft", async () => {
    const cycle = await opened();
    const self = await selfRequestOf(cycle.id, people.bruno);
    await db
      .update(reviewRequest)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        sharedAt: new Date(),
      })
      .where(eq(reviewRequest.id, self.id));
    await expect(
      reopenRequest(db, manager(people.carla), self.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    const reopened = await reopenRequest(db, hr, self.id);
    expect(reopened).toMatchObject({
      status: "draft",
      submittedAt: null,
      sharedAt: null,
    });
    await expect(reopenRequest(db, hr, self.id)).rejects.toMatchObject({
      code: "invalid_state",
    });
    await closeCycle(db, hr, cycle.id);
    await db
      .update(reviewRequest)
      .set({ status: "submitted" })
      .where(eq(reviewRequest.id, self.id));
    await expect(reopenRequest(db, hr, self.id)).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("counts submitted self and manager requests of active participants", async () => {
    const cycle = await opened();
    const self = await selfRequestOf(cycle.id, people.bruno);
    await db
      .update(reviewRequest)
      .set({ status: "submitted" })
      .where(eq(reviewRequest.id, self.id));
    expect(await cycleProgress(db, cycle.id)).toEqual({
      self: { submitted: 1, total: 2 },
      manager: { submitted: 0, total: 2 },
    });
    await removeParticipant(db, hr, cycle.id, people.bruno);
    expect(await cycleProgress(db, cycle.id)).toEqual({
      self: { submitted: 0, total: 1 },
      manager: { submitted: 0, total: 1 },
    });
  });

  it("lists the requests with names, for People only", async () => {
    const cycle = await opened();
    const list = await listCycleRequests(db, hr, cycle.id);
    expect(list).toHaveLength(4);
    expect(
      list.find(
        (r) => r.revieweeName === "Bruno Pérez" && r.relationship === "manager",
      ),
    ).toMatchObject({
      reviewerName: "Carla Romero",
      status: "draft",
      removed: false,
    });
    await expect(
      listCycleRequests(db, manager(people.carla), cycle.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
