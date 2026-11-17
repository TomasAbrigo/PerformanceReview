import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { cycleParticipant } from "@/db/schema";
import { canOpenAssessment } from "@/modules/insights/authz";
import { participantAssessment } from ".";
import { insertParticipant } from "@/modules/analytics/test-support";
import {
  as,
  buildScenario,
  direction,
  hr,
  insertCycle,
  insertReview,
  reset,
  type Scenario,
} from "./test-support";

let s: Scenario;

beforeAll(async () => {
  s = await buildScenario();
});
afterAll(async () => {
  await reset();
  await closeDb();
});

const read = (
  actor: Parameters<typeof participantAssessment>[1],
  who: keyof Scenario["participant"],
) => participantAssessment(db, actor, s.h1.cycleId, s.participant[who]);

describe("participantAssessment", () => {
  it("shows People the goals of the period and the answers of the submitted reviews", async () => {
    const a = await read(hr, "ana");
    expect(a.cycle).toMatchObject({
      name: "H1 2024",
      periodStart: "2024-01-01",
      periodEnd: "2024-06-30",
    });
    expect(a.participant).toMatchObject({
      name: "Ana Prieto",
      managerName: "Marta Quiroga",
      department: "Ingeniería",
      removed: false,
    });
    // By due date: 03-31, 05-31, 06-15, 06-30, 09-30.
    expect(
      a.goals.map((g) => [g.title, g.status, g.percentComplete, g.dueDate]),
    ).toEqual([
      ["Goal 1", "completed", 100, "2024-03-31"],
      ["Goal 2", "completed", 100, "2024-05-31"],
      ["Goal 4", "completed", 100, "2024-06-15"],
      ["Goal 3", "completed", 100, "2024-06-30"],
      ["Goal 5", "in_progress", 60, "2024-09-30"],
    ]);
    expect(a.goalsAsOf).toBeInstanceOf(Date);
    // Self first, then the manager's.
    expect(a.reviews.map((r) => [r.relationship, r.reviewerName])).toEqual([
      ["self", "Ana Prieto"],
      ["manager", "Marta Quiroga"],
    ]);
    const manager = a.reviews[1].review;
    expect(manager.answers[s.h1.questions.retention]).toBe(2);
    expect(manager.answers[s.h1.questions.engagement]).toBe(4);
    expect(a.reviews[0].review.questions.length).toBeGreaterThan(0);
  });

  it("flags overdue goals and the ones that no longer apply; a person without goals has none", async () => {
    const bruno = await read(hr, "bruno");
    expect(bruno.goals.map((g) => [g.dueDate, g.status, g.overdue])).toEqual([
      ["2024-02-01", "closed", false],
      ["2024-04-15", "completed", false],
      ["2024-05-01", "in_progress", true],
      ["2024-06-30", "in_progress", false],
    ]);
    const carla = await read(hr, "carla");
    // It is in progress and past due, but it no longer applies: never overdue
    // (the KPIs do not count it either).
    expect(carla.goals.find((g) => g.noLongerApplicable)).toMatchObject({
      status: "in_progress",
      overdue: false,
    });
    const dario = await read(hr, "dario");
    expect(dario.goals).toEqual([]);
    expect(dario.goalsAsOf).toBeNull();
  });

  it("only lists the reviews that were submitted", async () => {
    await insertReview({
      cycle: s.h1,
      participantId: s.participant.hugo,
      reviewerPersonId: s.id.marta,
      retention: 1,
      engagement: 1,
      status: "draft",
    });
    const hugo = await read(hr, "hugo");
    expect(hugo.reviews.map((r) => r.relationship)).toEqual(["manager"]);
    expect(hugo.reviews[0].review.answers[s.h1.questions.retention]).toBe(4);
  });

  it("a manager reads their direct reports of the snapshot, answers included", async () => {
    const a = await read(as(s.id.marta, "manager"), "ana");
    expect(a.goals).toHaveLength(5);
    expect(a.reviews.map((r) => r.relationship)).toEqual(["self", "manager"]);
    expect(a.reviews[1].review.answers[s.h1.questions.retention]).toBe(2);
  });

  it("a manager of another team, and the person themself, are forbidden", async () => {
    await expect(read(as(s.id.nora, "manager"), "ana")).rejects.toMatchObject({
      code: "forbidden",
    });
    // Ana reports to Nora today but reported to Marta at the snapshot.
    await expect(read(as(s.id.ana, "employee"), "ana")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(read(direction, "ana")).rejects.toMatchObject({
      code: "forbidden",
    });
    // Not even as a manager, about themself.
    await expect(read(as(s.id.ana, "manager"), "ana")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("a participant removed from the cycle is People's only", async () => {
    const zoe = await read(hr, "zoe");
    expect(zoe.participant.removed).toBe(true);
    await expect(read(as(s.id.marta, "manager"), "zoe")).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("opens exactly what the cycle page links to: one predicate, no link that ends in a refusal", async () => {
    const participants = await db.select().from(cycleParticipant);
    const actors = [
      hr,
      as(s.id.marta, "manager"),
      as(s.id.nora, "manager"),
      as(s.id.ana, "manager"),
      as(s.id.ana, "employee"),
      direction,
    ];
    for (const actor of actors) {
      for (const p of participants.filter((p) => p.cycleId === s.h1.cycleId)) {
        const linked = canOpenAssessment(actor, p);
        const opened = await participantAssessment(
          db,
          actor,
          p.cycleId,
          p.id,
        ).then(
          () => true,
          (error: unknown) => {
            expect(error).toMatchObject({ code: "forbidden" });
            return false;
          },
        );
        expect(opened, `${actor.role} ${actor.personId} ${p.id}`).toBe(linked);
      }
    }
  });

  it("is not_found for a draft cycle, as the queries leave drafts out", async () => {
    const draft = await insertCycle({
      name: "Borrador",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
      status: "draft",
    });
    const participantId = await insertParticipant({
      cycleId: draft.cycleId,
      personId: s.id.bruno,
      snapManagerPersonId: s.id.marta,
    });
    await expect(
      participantAssessment(db, hr, draft.cycleId, participantId),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("is not_found for a participant of another cycle or a bad id", async () => {
    await expect(
      participantAssessment(db, hr, s.h2.cycleId, s.participant.bruno),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      participantAssessment(db, hr, "nope", s.participant.bruno),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      participantAssessment(db, hr, s.h1.cycleId, "nope"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
