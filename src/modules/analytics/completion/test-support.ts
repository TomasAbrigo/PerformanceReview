import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  answer,
  assessmentProgress,
  type ProgressStatus,
  questionRevision,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import {
  insertJob,
  insertParticipant,
  insertPerson,
  insertReviewRequest,
} from "../test-support";

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
export async function resetCompletionData() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run, app_setting, admin_audit_log CASCADE`,
  );
}

export async function closedCycle(
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

/** Empties the tables and writes the people, cycles and rows described above. */
export async function buildCompletionScenario() {
  await resetCompletionData();
  const [marta, nico, ana, beto, carla, dani, emi, fede, gaby] =
    await Promise.all(
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

  const c0 = await closedCycle("2024-H2", "2024-07-01", "2024-12-31");
  await closedCycle("2024-Q4 borrado", "2024-10-01", "2024-12-31", {
    deleted: true,
  });
  const c1 = await closedCycle("2025-H1", "2025-01-01", "2025-06-30");
  const draftCycle = await closedCycle("2025-H2", "2025-07-01", "2025-12-31", {
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

  const c2 = await closedCycle("2026-H1", "2026-01-01", "2026-06-30");
  const a2 = await p(c2, ana, "Tecnología", marta);
  const b2 = await p(c2, beto, "Tecnología", marta);
  await request(c2, a2, ana, "self", "submitted");
  await request(c2, a2, marta, "manager", "submitted");
  await request(c2, b2, beto, "self", "draft");
  await request(c2, b2, marta, "manager", "declined");
  return {
    marta,
    nico,
    ana,
    beto,
    carla,
    dani,
    emi,
    fede,
    gaby,
    hugo,
    c0,
    c1,
    c2,
    draftCycle,
  };
}
