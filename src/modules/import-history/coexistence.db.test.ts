import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  cycleParticipant,
  employeeJobHistory,
  person,
  questionRevision,
  reviewCycle,
  reviewRequest,
  sourceIdentity,
} from "@/db/schema";
import { importReport, resetDb, writeCsv } from "./test-support";

/*
 * Coexistence with Bamboo (#106): an assessment written in the app (a native
 * cycle) that Bamboo's raw assessments report also has (same person, same
 * review period, same side) is overwritten by the import, never duplicated,
 * and counted as `nativeOverwritten`.
 */

const HEADER = [
  "EEID",
  "Review Period Start",
  "Correo electrónico del trabajo",
  "Employee - What do I do well?",
  "Manager - What does [Employee] do well?",
  "Self Assessment Completed Date",
  "Manager Assessment Completed Date",
  "Manager At Time Of Assessment",
].join(",");

const ROW =
  "13,03/29/2026,bruno@example.test,Lo de Bamboo (self),Lo de Bamboo (manager),04/20/2026,04/25/2026,Ana García";

let ana: string;
let bruno: string;

async function addPerson(displayName: string, workEmail: string) {
  const [row] = await db
    .insert(person)
    .values({ displayName, workEmail })
    .returning({ id: person.id });
  return row.id;
}

/** A native cycle over the report's period with Bruno's two reviews written in the app. */
async function nativeCycle(periodStart: string, periodEnd: string) {
  const [cycle] = await db
    .insert(reviewCycle)
    .values({
      name: "Evaluación 2026 S1 (app)",
      periodStart,
      periodEnd,
      snapshotDate: periodStart,
      status: "collecting",
      components: {
        self: true,
        manager: true,
        peer: false,
        upward: false,
        calibration: false,
      },
      anonymity: { peer: "transparent", upward: "transparent" },
    })
    .returning();
  const [participant] = await db
    .insert(cycleParticipant)
    .values({
      cycleId: cycle.id,
      revieweePersonId: bruno,
      snapshotAsOf: periodStart,
      snapManagerPersonId: ana,
    })
    .returning();
  const [revision] = await db
    .insert(questionRevision)
    .values({
      cycleId: cycle.id,
      sectionTitle: { es: "General", en: "General" },
      prompt: { es: "¿Qué hacés bien?", en: "What do you do well?" },
      kind: "text",
      appliesTo: ["self", "manager"],
      visibleToReviewee: true,
      required: false,
      sort: 0,
    })
    .returning();
  const requests = await db
    .insert(reviewRequest)
    .values([
      {
        cycleId: cycle.id,
        participantId: participant.id,
        reviewerPersonId: bruno,
        relationship: "self" as const,
        status: "submitted" as const,
        submittedAt: new Date("2026-05-01T12:00:00Z"),
      },
      {
        cycleId: cycle.id,
        participantId: participant.id,
        reviewerPersonId: ana,
        relationship: "manager" as const,
        status: "draft" as const,
      },
    ])
    .returning();
  await db.insert(answer).values(
    requests.map((r) => ({
      requestId: r.id,
      questionRevisionId: revision.id,
      textValue: `Lo de la app (${r.relationship})`,
    })),
  );
  return { cycle, requests };
}

const textsOf = async (requestId: string) =>
  (
    await db
      .select({ text: answer.textValue })
      .from(answer)
      .where(eq(answer.requestId, requestId))
  )
    .map((a) => a.text)
    .sort();

describe("assessments report over native reviews (#106)", () => {
  beforeEach(async () => {
    await resetDb();
    ana = await addPerson("Ana García", "ana@example.test");
    bruno = await addPerson("Bruno Pérez", "bruno@example.test");
    await db.insert(employeeJobHistory).values({
      personId: bruno,
      validFrom: "2020-01-01",
      managerPersonId: ana,
      department: "Ingeniería",
    });
    await db.insert(sourceIdentity).values({
      personId: bruno,
      sourceSystem: "bamboo_api",
      kind: "bamboo_id",
      value: "13",
    });
  });
  afterAll(async () => {
    await resetDb();
    await closeDb();
  });

  it("writes into the native cycle of the period and overwrites both sides", async () => {
    const { cycle, requests } = await nativeCycle("2026-03-29", "2026-09-28");
    const file = await writeCsv([HEADER, ROW]);

    const run = await importReport(file, "bamboo-assessments-report");

    expect(run.status).toBe("succeeded");
    expect(run.counts.nativeOverwritten).toBe(2);
    // No imported cycle next to the native one: one cycle, two reviews.
    expect(await db.$count(reviewCycle)).toBe(1);
    const after = await db
      .select()
      .from(reviewRequest)
      .where(eq(reviewRequest.cycleId, cycle.id));
    expect(after).toHaveLength(2);
    for (const r of requests) {
      const kept = after.find((a) => a.id === r.id)!;
      expect(kept).toMatchObject({
        sourceSystem: "bamboo_export",
        status: "submitted",
      });
      expect(kept.sourceId).toMatch(new RegExp(`#${r.relationship}$`));
      expect(await textsOf(r.id)).toEqual([`Lo de Bamboo (${r.relationship})`]);
    }
  });

  it("is idempotent: a second import finds the reviews by their Bamboo id", async () => {
    await nativeCycle("2026-03-29", "2026-09-28");
    const file = await writeCsv([HEADER, ROW]);
    await importReport(file, "bamboo-assessments-report");
    const again = await importReport(file, "bamboo-assessments-report");
    expect(again.counts.nativeOverwritten).toBeUndefined();
    expect(await db.$count(reviewRequest)).toBe(2);
    expect(await db.$count(reviewCycle)).toBe(1);
  });

  it("keeps its own cycle when no native cycle covers the period", async () => {
    await nativeCycle("2026-10-01", "2027-03-28");
    const file = await writeCsv([HEADER, ROW]);
    const run = await importReport(file, "bamboo-assessments-report");
    expect(run.counts.nativeOverwritten).toBeUndefined();
    expect(await db.$count(reviewCycle)).toBe(2);
    expect(await db.$count(reviewRequest)).toBe(4);
  });
});
