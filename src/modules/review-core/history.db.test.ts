import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { questionRevision } from "@/db/schema";
import { acknowledge, reviewHistory, transition } from ".";
import {
  as,
  askBoth,
  collectingCycle,
  hr,
  loadPeople,
  outsider,
  people,
  resetDb,
  revisions,
  sharedCycle,
  systemTemplateId,
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

/**
 * Bruno's story: H1 2022 (snapshot 2022-06-01: Developer, reports to Carla)
 * is shared; H1 2024 (snapshot 2024-06-01: Senior Developer, reports to Ana)
 * is closed without sharing; H2 2022 is still collecting. Today Bruno
 * reports to Ana.
 */
async function story() {
  const first = await sharedCycle(templateId);
  const second = await collectingCycle(templateId, {
    name: "H1 2024",
    periodStart: "2024-01-01",
    periodEnd: "2024-06-30",
    snapshotDate: "2024-06-01",
  });
  for (const to of ["manager_review", "sharing", "closed"] as const) {
    await transition(db, second.id, to, null);
  }
  await collectingCycle(templateId, {
    name: "H2 2022",
    periodStart: "2022-07-01",
    periodEnd: "2022-12-31",
    snapshotDate: "2022-12-01",
  });
  return { first, second };
}

const names = (items: { cycleName: string }[]) => items.map((i) => i.cycleName);

describe("reviewHistory", () => {
  it("lists finalized or shared cycles, newest first, with the snapshot manager and job", async () => {
    await story();
    const items = await reviewHistory(db, hr, people.bruno);
    // The collecting cycle is neither closed nor shared.
    expect(names(items)).toEqual(["H1 2024", "H1 2022"]);

    const [closed, shared] = items;
    expect(shared).toMatchObject({
      cycleName: "H1 2022",
      periodStart: "2022-01-01",
      periodEnd: "2022-06-30",
      managerName: "Carla Romero", // not Ana, the current manager
      managerPersonId: people.carla,
      jobTitle: "Developer", // not Senior Developer
      department: "Ingeniería",
      acknowledgedAt: null,
    });
    expect(shared.sharedAt).not.toBeNull();
    expect(closed).toMatchObject({
      cycleName: "H1 2024",
      cycleStatus: "closed",
      managerName: "Ana García",
      jobTitle: "Senior Developer",
      sharedAt: null,
    });
  });

  it("uses the snapshot manager even after the person changed manager", async () => {
    const { first } = await story();
    const [item] = (await reviewHistory(db, hr, people.bruno)).filter(
      (i) => i.cycleId === first.cycle.id,
    );
    expect(item.managerName).toBe("Carla Romero");
    expect(item.managerPersonId).not.toBe(people.ana);
  });

  it("the current rating comes from the manager's overall rating", async () => {
    const { first } = await story();
    const rating = (await revisions(first.cycle.id))
      .filter((q) => q.kind === "rating" && q.appliesTo.includes("manager"))
      .at(-1)!;
    const option = rating.scale!.options[0];
    const [item] = (await reviewHistory(db, hr, people.bruno)).filter(
      (i) => i.cycleId === first.cycle.id,
    );
    expect(item.rating).toEqual({
      value: option.value,
      label: option.label,
      normalized: option.normalized,
    });
    // Closed but never reviewed: no rating.
    const closed = (await reviewHistory(db, hr, people.bruno))[0];
    expect(closed.rating).toBeNull();
  });

  it("the employee sees their shared cycles with the answers visible to them", async () => {
    const { first } = await story();
    const hiddenIds = (
      await askBoth(
        first.cycle.id,
        (q) => q.kind === "text" && q.appliesTo.includes("manager"),
      )
    )
      .slice(0, 1)
      .map((q) => q.id);
    await db
      .update(questionRevision)
      .set({ visibleToReviewee: false })
      .where(eq(questionRevision.id, hiddenIds[0]));

    const items = await reviewHistory(db, as(people.bruno), people.bruno);
    expect(names(items)).toEqual(["H1 2022"]); // the closed, unshared one is not theirs yet
    const [item] = items;
    expect(item.rating).not.toBeNull();
    expect(item.self?.request.status).toBe("submitted");
    expect(item.manager?.request.status).toBe("submitted");
    expect(item.manager!.questions.every((q) => q.visibleToReviewee)).toBe(
      true,
    );
    expect(Object.keys(item.manager!.answers)).not.toContain(hiddenIds[0]);
    expect(item.canCompare).toBe(true);

    // HR reads all of it.
    const [forHr] = (await reviewHistory(db, hr, people.bruno)).filter(
      (i) => i.cycleId === first.cycle.id,
    );
    expect(Object.keys(forHr.manager!.answers)).toContain(hiddenIds[0]);
  });

  it("hides a rating the employee is not allowed to see", async () => {
    const { first } = await story();
    const rating = (await revisions(first.cycle.id))
      .filter((q) => q.kind === "rating" && q.appliesTo.includes("manager"))
      .at(-1)!;
    await db
      .update(questionRevision)
      .set({ visibleToReviewee: false })
      .where(eq(questionRevision.id, rating.id));
    const [mine] = await reviewHistory(db, as(people.bruno), people.bruno);
    expect(mine.rating).toBeNull();
    const [forHr] = (await reviewHistory(db, hr, people.bruno)).filter(
      (i) => i.cycleId === first.cycle.id,
    );
    expect(forHr.rating).not.toBeNull();
  });

  it("shows the acknowledgement", async () => {
    await story();
    const [item] = await reviewHistory(db, as(people.bruno), people.bruno);
    await acknowledge(db, as(people.bruno), item.participantId, "Leído");
    const [after] = await reviewHistory(db, as(people.bruno), people.bruno);
    expect(after.acknowledgedAt).not.toBeNull();
  });

  it("the snapshot manager sees only the cycles they managed", async () => {
    await story();
    // Carla manages nobody named Bruno now, but did in H1 2022.
    const items = await reviewHistory(
      db,
      as(people.carla, "manager"),
      people.bruno,
    );
    expect(names(items)).toEqual(["H1 2022"]);
    expect(items[0].manager?.request.status).toBe("submitted");
    expect(items[0].self?.request.status).toBe("submitted");
  });

  it("the current manager sees every cycle, including ones they did not manage", async () => {
    await story();
    const items = await reviewHistory(
      db,
      as(people.ana, "manager"),
      people.bruno,
    );
    expect(names(items)).toEqual(["H1 2024", "H1 2022"]);
    expect(items[1].managerName).toBe("Carla Romero");
    expect(items[1].rating).not.toBeNull();
  });

  it("refuses people with no relation and unknown people", async () => {
    await story();
    await expect(
      reviewHistory(db, outsider(), people.bruno),
    ).rejects.toMatchObject({ code: "forbidden" });
    // Carla is nobody's report here: Bruno cannot read her history either.
    await expect(
      reviewHistory(db, as(people.bruno), people.carla),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      reviewHistory(db, hr, "00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(reviewHistory(db, hr, "nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("is empty for a person with no finalized cycles", async () => {
    await collectingCycle(templateId);
    expect(await reviewHistory(db, hr, people.bruno)).toEqual([]);
    expect(await reviewHistory(db, as(people.bruno), people.bruno)).toEqual([]);
  });
});
