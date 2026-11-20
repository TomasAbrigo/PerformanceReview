import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { assessmentProgress } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  employmentIdOf,
  insertJob,
  insertParticipant,
  insertPerson,
  resetAll,
} from "@/modules/analytics/test-support";
import { insertReviewCycle } from "@/modules/api/review-test-support";
import { listAssessmentParticipants } from "./queries";

/**
 * An imported cycle has no review requests, only Bamboo's Assessment Progress
 * (#144): a side "En curso" there is a draft, not "Sin solicitud".
 */
let cycle: string;
let ana: string;
let bruno: string;
let dora: string;

const hr: ActorContext = { personId: null, role: "hr" };

async function newPerson(name: string, bambooId: string, manager?: string) {
  const id = await insertPerson({ displayName: name, bambooId });
  await insertJob({
    personId: id,
    validFrom: "2020-01-01",
    managerPersonId: manager ?? null,
    employmentId: await employmentIdOf(id),
    department: "Producto",
  });
  return id;
}

beforeAll(async () => {
  await resetAll();
  ana = await newPerson("Ana Prieto", "1");
  bruno = await newPerson("Bruno Gil", "2", ana);
  dora = await newPerson("Dora Díaz", "3", bruno);
  cycle = await insertReviewCycle({ name: "Importado", status: "closed" });
  const participant = await insertParticipant({
    cycleId: cycle,
    personId: dora,
    snapManagerPersonId: bruno,
    snapDepartment: "Producto",
  });
  await db.insert(assessmentProgress).values({
    cycleId: cycle,
    participantId: participant,
    selfStatus: "in_progress",
    managerStatus: "not_started",
    assessed: false,
    sourceSystem: "bamboo_export",
    sourceId: "p1",
    payloadHash: "h",
  });
});
afterAll(async () => {
  await resetAll();
  await closeDb();
});

describe("listAssessmentParticipants with imported progress", () => {
  it("shows an in-progress imported side as a draft to People", async () => {
    const page = await listAssessmentParticipants(db, hr, cycle);
    expect(page.items[0]).toMatchObject({
      self: { state: "draft" },
      managerReview: { state: "none" },
    });
  });

  it("shows it to the employee on their own side only, locked for the manager's", async () => {
    const page = await listAssessmentParticipants(
      db,
      { role: "employee", personId: dora },
      cycle,
    );
    expect(page.items[0].self.state).toBe("draft");
    const manager = await listAssessmentParticipants(
      db,
      { role: "manager", personId: bruno },
      cycle,
    );
    expect(manager.items.find((r) => r.person.id === dora)?.self.state).toBe(
      "locked",
    );
  });
});
