import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  answer,
  assessmentProgress,
  type ProgressStatus,
  questionRevision,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { setSetting } from "@/modules/settings";
import {
  insertJob,
  insertParticipant,
  insertPerson,
  insertReviewRequest,
} from "../test-support";
import {
  completionCycles,
  completionDelta,
  completionSummary,
  missingAssessments,
} from ".";

// Two cycles with participants; hand-computed from the rows below.
//
// 2025-H1 (C1, closed), snapshot manager / department:
//   ana    Tecnología  Marta  progress self submitted,   manager submitted
//          (and a draft self request: the progress row wins)
//   beto   Tecnología  Marta  progress self submitted,   manager in_progress
//   carla  Tecnología  Nico   progress self not_started, manager not_started (notes)
//   dani   Ventas      Nico   progress self submitted,   manager not_applicable
//   emi    Ventas      Nico   no progress; self request submitted, manager
//                             draft with an answer (in_progress)
//   fede   Ventas      Nico   no progress, no requests: nothing applies
//   gaby   (none)      Marta  progress self not_started, manager submitted ("  " notes)
//   hugo   Tecnología  Marta  removed from the cycle: out of everything
//
// 2024-H2 (C0, closed), all with progress rows:
//   ana, beto, carla  Tecnología: self submitted x3; manager submitted, submitted, not_started
//   dani              Ventas:     self not_started,   manager not_applicable
// Also: a draft cycle and a deleted one, never the "previous" of C1, and
// 2026-H1 (C2) with requests only: ana submitted both, beto a draft self
// request without answers and a declined manager one.
let ana: string;
let beto: string;
let carla: string;
let dani: string;
let emi: string;
let fede: string;
let gaby: string;
let marta: string;
let nico: string;
let c1: string;
let c0: string;
let c2: string;
let draftCycle: string;

const hr: ActorContext = { personId: null, role: "hr" };
const direction: ActorContext = { personId: null, role: "direction" };
const as = (
  personId: string,
  role: ActorContext["role"] = "employee",
): ActorContext => ({ personId, role });

async function reset() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run, app_setting, admin_audit_log CASCADE`,
  );
}

async function cycle(
  name: string,
  periodStart: string,
  periodEnd: string,
  extra: { status?: "draft" | "closed"; deleted?: boolean } = {},
) {
  const [row] = await db
    .insert(reviewCycle)
    .values({
      name,
      periodStart,
      periodEnd,
      snapshotDate: periodEnd,
      status: extra.status ?? "closed",
      components: {
        self: true,
        manager: true,
        peer: false,
        upward: false,
        calibration: false,
      },
      anonymity: { peer: "transparent", upward: "transparent" },
      deletedAt: extra.deleted ? new Date() : null,
    })
    .returning({ id: reviewCycle.id });
  return row.id;
}

async function progress(
  cycleId: string,
  participantId: string,
  self: ProgressStatus,
  manager: ProgressStatus,
  followUpNotes: string | null = null,
) {
  await db.insert(assessmentProgress).values({
    cycleId,
    participantId,
    selfStatus: self,
    managerStatus: manager,
    assessed: self === "submitted" && manager === "submitted",
    followUpNotes,
    sourceSystem: "bamboo_export",
    sourceId: `${cycleId}:${participantId}`,
    payloadHash: "h",
  });
}

async function request(
  cycleId: string,
  participantId: string,
  reviewer: string,
  relationship: "self" | "manager",
  status: "draft" | "submitted" | "declined" | "superseded",
  extra: { answered?: boolean; deleted?: boolean } = {},
) {
  const id = await insertReviewRequest({
    cycleId,
    participantId,
    reviewerPersonId: reviewer,
    relationship,
    deleted: extra.deleted,
  });
  await db
    .update(reviewRequest)
    .set({ status, submittedAt: status === "submitted" ? new Date() : null })
    .where(eq(reviewRequest.id, id));
  if (extra.answered) {
    const [q] = await db
      .insert(questionRevision)
      .values({
        cycleId,
        sectionTitle: { es: "S", en: "S" },
        prompt: { es: "P", en: "P" },
        kind: "text",
        appliesTo: [relationship],
        visibleToReviewee: true,
        required: false,
        sort: 0,
      })
      .returning({ id: questionRevision.id });
    await db
      .insert(answer)
      .values({ requestId: id, questionRevisionId: q.id, textValue: "x" });
  }
  return id;
}

const job = (
  personId: string,
  department: string | null,
  managerPersonId: string | null,
) =>
  insertJob({
    personId,
    validFrom: "2020-01-01",
    department,
    managerPersonId,
  });

beforeAll(async () => {
  await reset();
  [marta, nico, ana, beto, carla, dani, emi, fede, gaby] = await Promise.all(
    [
      "Marta Gómez",
      "Nico Ruiz",
      "Ana Aguirre",
      "Beto Benítez",
      "Carla Cabrera",
      "Dani Domínguez",
      "Emi Estévez",
      "Fede Funes",
      "Gaby Giménez",
    ].map((displayName, i) =>
      insertPerson({
        displayName,
        workEmail: `p${i}@example.test`,
        bambooId: `b${i}`,
      }),
    ),
  );
  const hugo = await insertPerson({ displayName: "Hugo Herrera" });
  // Today's org (hierarchy "current"): Beto moved to Ventas under Nico.
  await job(marta, "Dirección", null);
  await job(nico, "Dirección", null);
  await job(ana, "Tecnología", marta);
  await job(beto, "Ventas", nico);
  await job(carla, "Tecnología", nico);
  await job(dani, "Ventas", nico);
  await job(emi, "Ventas", nico);
  await job(fede, "Ventas", nico);
  await job(gaby, "Tecnología", marta);

  c0 = await cycle("2024-H2", "2024-07-01", "2024-12-31");
  await cycle("2024-Q4 borrado", "2024-10-01", "2024-12-31", {
    deleted: true,
  });
  c1 = await cycle("2025-H1", "2025-01-01", "2025-06-30");
  draftCycle = await cycle("2025-H2", "2025-07-01", "2025-12-31", {
    status: "draft",
  });

  const p = (
    cycleId: string,
    personId: string,
    department: string | null,
    manager: string | null,
    removed = false,
  ) =>
    insertParticipant({
      cycleId,
      personId,
      snapManagerPersonId: manager,
      snapDepartment: department,
      removed,
    });
  const a1 = await p(c1, ana, "Tecnología", marta);
  const b1 = await p(c1, beto, "Tecnología", marta);
  const c1c = await p(c1, carla, "Tecnología", nico);
  const d1 = await p(c1, dani, "Ventas", nico);
  const e1 = await p(c1, emi, "Ventas", nico);
  await p(c1, fede, "Ventas", nico);
  const g1 = await p(c1, gaby, null, marta);
  await p(c1, hugo, "Tecnología", marta, true);
  await progress(c1, a1, "submitted", "submitted");
  await progress(c1, b1, "submitted", "in_progress", "   ");
  await progress(c1, c1c, "not_started", "not_started", "Llamar el lunes");
  await progress(c1, d1, "submitted", "not_applicable");
  await progress(c1, g1, "not_started", "submitted");
  // Ana's requests disagree with her progress row: the progress row wins.
  await request(c1, a1, ana, "self", "draft");
  await request(c1, e1, emi, "self", "submitted");
  await request(c1, e1, nico, "manager", "draft", { answered: true });
  // Not live requests do not count: a deleted one and a superseded one.
  await request(c1, e1, carla, "manager", "submitted", { deleted: true });
  await request(c1, e1, marta, "manager", "superseded");

  const a0 = await p(c0, ana, "Tecnología", marta);
  const b0 = await p(c0, beto, "Tecnología", marta);
  const c0c = await p(c0, carla, "Tecnología", nico);
  const d0 = await p(c0, dani, "Ventas", nico);
  await progress(c0, a0, "submitted", "submitted");
  await progress(c0, b0, "submitted", "submitted");
  await progress(c0, c0c, "submitted", "not_started");
  await progress(c0, d0, "not_started", "not_applicable");

  c2 = await cycle("2026-H1", "2026-01-01", "2026-06-30");
  const a2 = await p(c2, ana, "Tecnología", marta);
  const b2 = await p(c2, beto, "Tecnología", marta);
  await request(c2, a2, ana, "self", "submitted");
  await request(c2, a2, marta, "manager", "submitted");
  await request(c2, b2, beto, "self", "draft");
  await request(c2, b2, marta, "manager", "declined");
});

afterAll(async () => {
  await reset();
  await closeDb();
});

const byLabel = <T extends { label: string | null }>(rows: T[]) =>
  Object.fromEntries(rows.map((r) => [r.label ?? "∅", r]));

const counts = (g: {
  participants: number;
  selfSubmitted: number;
  selfApplicable: number;
  managerSubmitted: number;
  managerApplicable: number;
}) => [
  g.participants,
  g.selfSubmitted,
  g.selfApplicable,
  g.managerSubmitted,
  g.managerApplicable,
];

describe("completionSummary", () => {
  it("all together: counts the progress rows first, then the live requests", async () => {
    const s = await completionSummary(db, hr, {
      cycleId: c1,
      groupBy: "none",
      hierarchy: "asOf",
    });
    expect(s.cycleName).toBe("2025-H1");
    expect(s.groupBy).toBe("none");
    // 7 participants (Hugo was removed). Self: ana, beto, dani, emi submitted
    // = 4 of the 6 it applies to (fede has no self assessment). Manager: ana,
    // gaby = 2 of the 5 it applies to (dani and fede have none).
    expect(counts(s.total!)).toEqual([7, 4, 6, 2, 5]);
    expect(s.total!.selfRate).toBeCloseTo(4 / 6);
    expect(s.total!.managerRate).toBeCloseTo(2 / 5);
    expect(s.groups).toEqual([]);
    expect(s.participants).toBe(7);
    expect(s.minGroupSize).toBeNull();
    // ana, beto, carla, dani, gaby have a progress row; emi and fede do not.
    expect(s.sources).toEqual({ progress: 5, requests: 2 });
  });

  it("by department of the snapshot, People's unassigned group included", async () => {
    const s = await completionSummary(db, hr, {
      cycleId: c1,
      groupBy: "department",
      hierarchy: "asOf",
    });
    const g = byLabel(s.groups);
    expect(Object.keys(g).sort()).toEqual(["Tecnología", "Ventas", "∅"]);
    expect(counts(g["Tecnología"])).toEqual([3, 2, 3, 1, 3]);
    expect(counts(g["Ventas"])).toEqual([3, 2, 2, 0, 1]);
    expect(counts(g["∅"])).toEqual([1, 0, 1, 1, 1]);
    expect(g["Ventas"].selfRate).toBe(1);
    expect(g["Ventas"].managerRate).toBe(0);
    expect(counts(s.total!)).toEqual([7, 4, 6, 2, 5]);
    expect(s.others).toBeNull();
  });

  it("by manager of the snapshot", async () => {
    const s = await completionSummary(db, hr, {
      cycleId: c1,
      groupBy: "manager",
      hierarchy: "asOf",
    });
    const g = byLabel(s.groups);
    expect(g["Marta Gómez"].key).toBe(marta);
    expect(counts(g["Marta Gómez"])).toEqual([3, 2, 3, 2, 3]);
    expect(counts(g["Nico Ruiz"])).toEqual([4, 2, 3, 0, 2]);
  });

  it("the current hierarchy groups by today's org instead of the snapshot", async () => {
    const s = await completionSummary(db, hr, {
      cycleId: c1,
      groupBy: "department",
      hierarchy: "current",
    });
    const g = byLabel(s.groups);
    // Beto is in Ventas today and Gaby in Tecnología; Fede and Emi stay.
    expect(counts(g["Tecnología"])).toEqual([3, 1, 3, 2, 3]); // ana, carla, gaby
    expect(counts(g["Ventas"])).toEqual([4, 3, 3, 0, 2]); // beto, dani, emi, fede
    expect(g["∅"]).toBeUndefined();
  });

  it("filters by department and manager", async () => {
    const ventas = await completionSummary(db, hr, {
      cycleId: c1,
      groupBy: "none",
      hierarchy: "asOf",
      department: "Ventas",
    });
    expect(counts(ventas.total!)).toEqual([3, 2, 2, 0, 1]);
    const marta1 = await completionSummary(db, hr, {
      cycleId: c1,
      groupBy: "none",
      hierarchy: "asOf",
      managerId: marta,
    });
    expect(counts(marta1.total!)).toEqual([3, 2, 3, 2, 3]);
  });

  it("a cycle without progress rows reads the requests: only the submitted ones count", async () => {
    const s = await completionSummary(db, hr, {
      cycleId: c2,
      groupBy: "none",
      hierarchy: "asOf",
    });
    // Ana submitted both; Beto's draft and declined requests apply, unsubmitted.
    expect(counts(s.total!)).toEqual([2, 1, 2, 1, 2]);
    expect(s.sources).toEqual({ progress: 0, requests: 2 });
  });

  it("the source is chosen per participant: a progress row, else the requests", async () => {
    const s = await completionSummary(db, hr, {
      cycleId: c1,
      groupBy: "none",
      hierarchy: "asOf",
      department: "Ventas",
      managerId: nico,
    });
    // Dani has a progress row; Emi and Fede only requests (Fede has none).
    expect(counts(s.total!)).toEqual([3, 2, 2, 0, 1]);
    expect(s.sources).toEqual({ progress: 1, requests: 2 });
  });

  it("a cycle that does not exist, or is a draft, is not found", async () => {
    for (const cycleId of [
      "00000000-0000-4000-8000-000000000000",
      "not-a-uuid",
      draftCycle,
    ]) {
      await expect(
        completionSummary(db, hr, {
          cycleId,
          groupBy: "none",
          hierarchy: "asOf",
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    }
  });

  describe("by role", () => {
    it("a manager sees their direct reports of the snapshot", async () => {
      const s = await completionSummary(db, as(marta, "manager"), {
        cycleId: c1,
        groupBy: "department",
        hierarchy: "asOf",
      });
      expect(s.participants).toBe(3);
      expect(counts(s.total!)).toEqual([3, 2, 3, 2, 3]);
      expect(s.groups.map((g) => g.label).sort()).toEqual(["Tecnología", null]);
      // Another manager's filter finds nobody among their reports.
      const other = await completionSummary(db, as(marta, "manager"), {
        cycleId: c1,
        groupBy: "none",
        hierarchy: "asOf",
        managerId: nico,
      });
      expect(other.participants).toBe(0);
    });

    it("with hierarchy current, a manager sees who reports to them today", async () => {
      const s = await completionSummary(db, as(nico, "manager"), {
        cycleId: c1,
        groupBy: "none",
        hierarchy: "current",
      });
      // beto, carla, dani, emi, fede report to Nico today.
      expect(s.participants).toBe(5);
    });

    it("an employee, or a manager without a person, is forbidden", async () => {
      for (const actor of [
        as(ana, "employee"),
        { personId: null, role: "manager" } as ActorContext,
      ]) {
        await expect(
          completionSummary(db, actor, {
            cycleId: c1,
            groupBy: "none",
            hierarchy: "asOf",
          }),
        ).rejects.toMatchObject({ code: "forbidden" });
      }
    });

    it("direction sees the groups that reach the minimum, and the rest as Otros", async () => {
      const three = await completionSummary(db, direction, {
        cycleId: c1,
        groupBy: "department",
        hierarchy: "asOf",
        minGroupSize: 3,
      });
      expect(three.minGroupSize).toBe(3);
      expect(three.groups.map((g) => g.label).sort()).toEqual([
        "Tecnología",
        "Ventas",
      ]);
      // Gaby (no department) is alone: under the minimum, and hidden.
      expect(three.others).toBeNull();
      expect(three.suppressed).toBe(1);
      expect(counts(three.total!)).toEqual([7, 4, 6, 2, 5]);

      const four = await completionSummary(db, direction, {
        cycleId: c1,
        groupBy: "department",
        hierarchy: "asOf",
        minGroupSize: 4,
      });
      // Two groups of 3 and one of 1: Otros of 7, over the minimum.
      expect(four.groups).toEqual([]);
      expect(counts(four.others!)).toEqual([7, 4, 6, 2, 5]);
      expect(four.suppressed).toBe(0);

      const two = await completionSummary(db, direction, {
        cycleId: c1,
        groupBy: "department",
        hierarchy: "asOf",
        minGroupSize: 2,
      });
      expect(two.groups).toHaveLength(2);
      expect(two.others).toBeNull();
      expect(two.suppressed).toBe(1);
    });

    it("direction gets only the head count when the cycle is under the minimum", async () => {
      const s = await completionSummary(db, direction, {
        cycleId: c1,
        groupBy: "department",
        hierarchy: "asOf",
        minGroupSize: 8,
      });
      expect(s.participants).toBe(7);
      expect(s.total).toBeNull();
      expect(s.groups).toEqual([]);
      expect(s.others).toBeNull();
    });

    it("direction never gets managers (nor filters), and reads the minimum from the settings", async () => {
      await setSetting(db, hr, "aggregation.minGroupSize", 3);
      const s = await completionSummary(db, direction, {
        cycleId: c1,
        groupBy: "manager",
        hierarchy: "asOf",
        managerId: marta,
        department: "Ventas",
      });
      expect(s.groupBy).toBe("none");
      expect(s.groups).toEqual([]);
      expect(s.minGroupSize).toBe(3);
      expect(s.participants).toBe(7);
    });
  });
});

describe("missingAssessments", () => {
  const rows = (
    list: Awaited<ReturnType<typeof missingAssessments>>,
  ): string[] => list.map((r) => r.name);

  it("lists who has not submitted a side, by manager and then name", async () => {
    const list = await missingAssessments(db, hr, { cycleId: c1 });
    // Ana is complete, Dani's manager side does not apply and Fede has none.
    expect(rows(list)).toEqual([
      "Beto Benítez",
      "Gaby Giménez",
      "Carla Cabrera",
      "Emi Estévez",
    ]);
    const [beto1, gaby1, carla1, emi1] = list;
    expect(beto1).toMatchObject({
      personId: beto,
      department: "Tecnología",
      managerId: marta,
      managerName: "Marta Gómez",
      selfStatus: "submitted",
      managerStatus: "in_progress",
      hasFollowUpNotes: false, // blank notes are no notes
      source: "progress",
    });
    expect(gaby1).toMatchObject({
      department: null,
      selfStatus: "not_started",
      managerStatus: "submitted",
    });
    expect(carla1).toMatchObject({
      selfStatus: "not_started",
      managerStatus: "not_started",
      hasFollowUpNotes: true,
    });
    // Emi: no progress row, so from her requests (the draft one has an answer).
    expect(emi1).toMatchObject({
      selfStatus: "submitted",
      managerStatus: "in_progress",
      source: "requests",
      hasFollowUpNotes: false,
    });
    expect(list.every((r) => r.email === undefined)).toBe(true);
  });

  it("filters by the side that is missing", async () => {
    expect(
      rows(
        await missingAssessments(db, hr, {
          cycleId: c1,
          status: "self_missing",
        }),
      ),
    ).toEqual(["Gaby Giménez", "Carla Cabrera"]);
    expect(
      rows(
        await missingAssessments(db, hr, {
          cycleId: c1,
          status: "manager_missing",
        }),
      ),
    ).toEqual(["Beto Benítez", "Carla Cabrera", "Emi Estévez"]);
  });

  it("filters by department and manager", async () => {
    expect(
      rows(
        await missingAssessments(db, hr, { cycleId: c1, department: "Ventas" }),
      ),
    ).toEqual(["Emi Estévez"]);
    expect(
      rows(await missingAssessments(db, hr, { cycleId: c1, managerId: nico })),
    ).toEqual(["Carla Cabrera", "Emi Estévez"]);
    expect(
      rows(
        await missingAssessments(db, hr, {
          cycleId: c1,
          department: "Tecnología",
          status: "self_missing",
        }),
      ),
    ).toEqual(["Carla Cabrera"]);
  });

  it("hierarchy current reads today's department and manager", async () => {
    const list = await missingAssessments(db, hr, {
      cycleId: c1,
      hierarchy: "current",
      managerId: nico,
    });
    expect(rows(list)).toEqual([
      "Beto Benítez",
      "Carla Cabrera",
      "Emi Estévez",
    ]);
    expect(list[0]).toMatchObject({
      department: "Ventas",
      managerName: "Nico Ruiz",
    });
  });

  it("only People get the email, and only when asked", async () => {
    const withEmail = await missingAssessments(db, hr, {
      cycleId: c1,
      includeEmail: true,
      managerId: marta,
    });
    expect(withEmail.map((r) => r.email)).toEqual([
      "p3@example.test", // beto
      "p8@example.test", // gaby
    ]);
    const asManager = await missingAssessments(db, as(marta, "manager"), {
      cycleId: c1,
      includeEmail: true,
    });
    expect(asManager.every((r) => r.email === undefined)).toBe(true);
  });

  it("a manager only sees their direct reports of the snapshot", async () => {
    const list = await missingAssessments(db, as(marta, "manager"), {
      cycleId: c1,
    });
    expect(rows(list)).toEqual(["Beto Benítez", "Gaby Giménez"]);
    // Asking for somebody else's team returns nothing, not an error.
    expect(
      await missingAssessments(db, as(marta, "manager"), {
        cycleId: c1,
        managerId: nico,
      }),
    ).toEqual([]);
  });

  it("direction (aggregates only), employees and a manager without a person are forbidden", async () => {
    for (const actor of [
      direction,
      as(ana, "employee"),
      { personId: null, role: "manager" } as ActorContext,
    ]) {
      await expect(
        missingAssessments(db, actor, { cycleId: c1 }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});

describe("completionDelta", () => {
  it("compares with the previous cycle by period start, in percentage points", async () => {
    const d = await completionDelta(db, hr, {
      cycleId: c1,
      groupBy: "department",
    });
    // The previous one skips the deleted cycle in between and the draft after.
    expect(d.previous?.cycleName).toBe("2024-H2");
    // 2024-H2: self 3 of 4, manager 2 of 3.
    expect(counts(d.previous!.total!)).toEqual([4, 3, 4, 2, 3]);
    // 2025-H1: self 4/6 (66.7 %), manager 2/5 (40 %).
    expect(d.total).toEqual({ selfDelta: -8.3, managerDelta: -26.7 });
    const rows = byLabel(d.groups);
    // Tecnología: self 2/3 vs 3/3, manager 1/3 vs 2/3.
    expect(rows["Tecnología"]).toMatchObject({
      selfDelta: -33.3,
      managerDelta: -33.3,
    });
    // Ventas: self 2/2 vs 0/1; its manager side did not apply before.
    expect(rows["Ventas"]).toMatchObject({
      selfDelta: 100,
      managerDelta: null,
    });
    // The unassigned group did not exist before.
    expect(rows["∅"]).toMatchObject({ selfDelta: null, managerDelta: null });
    expect(d.groups.map((g) => g.key)).toEqual(
      d.current.groups.map((g) => g.key),
    );
  });

  it("a requests-only cycle compares with the one before it", async () => {
    const d = await completionDelta(db, hr, { cycleId: c2, groupBy: "none" });
    expect(d.previous?.cycleName).toBe("2025-H1");
    // Self 1/2 vs 4/6, manager 1/2 vs 2/5.
    expect(d.total).toEqual({ selfDelta: -16.7, managerDelta: 10 });
  });

  it("the first cycle has nothing to compare with", async () => {
    const d = await completionDelta(db, hr, { cycleId: c0 });
    expect(d.previous).toBeNull();
    expect(d.total).toBeNull();
    expect(
      d.groups.every((g) => g.selfDelta === null && g.managerDelta === null),
    ).toBe(true);
  });

  it("direction: deltas only for the groups it may see in both cycles", async () => {
    const d = await completionDelta(db, direction, {
      cycleId: c1,
      groupBy: "department",
      minGroupSize: 3,
    });
    // Ventas had 1 person before (hidden); Tecnología had 3 and has 3.
    expect(d.current.groups.map((g) => g.label).sort()).toEqual([
      "Tecnología",
      "Ventas",
    ]);
    expect(d.previous!.groups.map((g) => g.label)).toEqual(["Tecnología"]);
    const t = d.groups.find((g) => g.label === "Tecnología")!;
    const v = d.groups.find((g) => g.label === "Ventas")!;
    expect(t).toMatchObject({ selfDelta: -33.3, managerDelta: -33.3 });
    expect(v).toMatchObject({ selfDelta: null, managerDelta: null });
    expect(d.total).toEqual({ selfDelta: -8.3, managerDelta: -26.7 });
  });

  it("is forbidden to employees", async () => {
    await expect(
      completionDelta(db, as(ana, "employee"), { cycleId: c1 }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("completionCycles", () => {
  it("lists the launched cycles, latest period first, without drafts or deleted ones", async () => {
    const list = await completionCycles(db);
    expect(list.map((c) => c.name)).toEqual(["2026-H1", "2025-H1", "2024-H2"]);
    expect(list[1]).toMatchObject({
      id: c1,
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
      status: "closed",
    });
  });
});

describe("a cycle without participants", () => {
  it("has no rates", async () => {
    const empty = await cycle("2026-H2", "2026-07-01", "2026-12-31");
    const s = await completionSummary(db, hr, {
      cycleId: empty,
      groupBy: "department",
      hierarchy: "asOf",
    });
    expect(s.participants).toBe(0);
    expect(counts(s.total!)).toEqual([0, 0, 0, 0, 0]);
    expect(s.total!.selfRate).toBeNull();
    expect(s.groups).toEqual([]);
  });
});
