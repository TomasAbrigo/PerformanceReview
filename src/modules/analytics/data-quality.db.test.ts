import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { employment } from "@/db/schema";
import {
  activeWithoutJobHistory,
  DATA_QUALITY_KEYS,
  duplicateDisplayNames,
  failedIngestRuns,
  getDataQuality,
  getIndicator,
  goalsWithoutLiveEmployment,
  jobHistoryGapsAndOverlaps,
  jobHistoryOpenAfterExit,
  openIdentityIssues,
  participantsWithIncompleteSnapshot,
  participantsWithoutSnapshotManager,
  peopleWithoutManager,
  reviewerMismatch,
} from "./data-quality";
import {
  employmentIdOf,
  ingestFixtureCompany,
  insertCycle,
  insertGoal,
  insertIdentityIssue,
  insertJob,
  insertParticipant,
  insertPerson,
  insertReviewRequest,
  insertRun,
  resetAll,
} from "./test-support";

const NOW = new Date("2026-11-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let ana: string;
let bruno: string;
let carla: string;

// People crafted for one anomaly each.
let dora: string; // active, no job history at all
let eli: string; // overlapping job rows
let fede: string; // gap inside one employment
let gus: string; // gap between two employments (rehire): legit
let hugo: string; // left, job row still open
let ines: string; // no live employment, owns goals
let maria1: string;
let maria2: string;
let ghostManagerless: string; // active, current row without manager
let nora: string; // gap inside employment 1 while employment 2 has a row in between
let olga: string; // null employment ids: no way to tell, never reported
let pablo: string; // overlap between two different employments
let quique: string; // only has a job row that starts in the future
let ramiro: string; // exit date 2025-01-01, job row left open

let overlapRow: string;
let gapRow: string;
let noraGapRow: string;
let pabloOverlapRow: string;
let inesRow: string;
let ramiroRow: string;
let hugoRow: string;
let issueOpen: string;
let cycleA: string;
let cycleB: string;
let partNoManager: string;
let partIncomplete: string;
let goalOfInes: string;
let failedRecent: string;
let mismatchRequest: string;

beforeAll(async () => {
  await resetAll();
  ({ ana, bruno, carla } = await ingestFixtureCompany());
});

afterAll(async () => {
  await resetAll();
  await closeDb();
});

describe("on the clean fixture company", () => {
  it("only the CEO is flagged (as top), nothing else", async () => {
    const noManager = await peopleWithoutManager(db);
    expect(noManager.items.map((i) => [i.id, i.displayName, i.isTop])).toEqual([
      [ana, "Ana García", true],
    ]);
    expect(noManager.count).toBe(1);

    for (const indicator of [
      await openIdentityIssues(db),
      await participantsWithoutSnapshotManager(db),
      await participantsWithIncompleteSnapshot(db),
      await jobHistoryGapsAndOverlaps(db),
      await jobHistoryOpenAfterExit(db),
      await activeWithoutJobHistory(db),
      await goalsWithoutLiveEmployment(db),
      await duplicateDisplayNames(db),
      await failedIngestRuns(db, { now: NOW }),
      await reviewerMismatch(db),
    ]) {
      expect([indicator.key, indicator.count, indicator.items]).toEqual([
        indicator.key,
        0,
        [],
      ]);
    }
  });
});

describe("on a crafted dataset", () => {
  beforeAll(async () => {
    dora = await insertPerson({ displayName: "Dora Díaz", bambooId: "201" });

    eli = await insertPerson({ displayName: "Eli Gómez", bambooId: "202" });
    await insertJob({
      personId: eli,
      validFrom: "2020-01-01",
      validTo: "2022-01-01",
      managerPersonId: ana,
    });
    overlapRow = await insertJob({
      personId: eli,
      validFrom: "2021-06-01",
      managerPersonId: ana,
    });

    fede = await insertPerson({ displayName: "Fede Ruiz", bambooId: "203" });
    const fedeEmp = await employmentIdOf(fede);
    await insertJob({
      personId: fede,
      validFrom: "2020-01-01",
      validTo: "2021-01-01",
      managerPersonId: ana,
      employmentId: fedeEmp,
    });
    gapRow = await insertJob({
      personId: fede,
      validFrom: "2021-03-01",
      managerPersonId: ana,
      employmentId: fedeEmp,
    });

    // Nora has two employments at once; the second one has a row in between
    // the two rows of the first one, which hides the gap of the first.
    nora = await insertPerson({
      displayName: "Nora Quiroga",
      bambooId: "211",
      hireDate: "2019-01-01",
    });
    const noraFirst = await employmentIdOf(nora);
    const [noraSecond] = await db
      .insert(employment)
      .values({
        personId: nora,
        hireDate: "2020-08-01",
        status: "Active",
        sourceSystem: "bamboo_api",
        sourceId: "211b",
      })
      .returning({ id: employment.id });
    await insertJob({
      personId: nora,
      validFrom: "2020-01-01",
      validTo: "2020-06-01",
      managerPersonId: ana,
      employmentId: noraFirst,
    });
    await insertJob({
      personId: nora,
      validFrom: "2020-09-01",
      validTo: "2020-12-01",
      managerPersonId: ana,
      employmentId: noraSecond.id,
    });
    noraGapRow = await insertJob({
      personId: nora,
      validFrom: "2021-01-01",
      managerPersonId: ana,
      employmentId: noraFirst,
    });

    // Rows without an employment id cannot be compared with each other.
    olga = await insertPerson({ displayName: "Olga Ríos", bambooId: "212" });
    await insertJob({
      personId: olga,
      validFrom: "2020-01-01",
      validTo: "2020-06-01",
      managerPersonId: ana,
    });
    await insertJob({
      personId: olga,
      validFrom: "2021-01-01",
      managerPersonId: ana,
    });

    // Two employments cannot be valid at once: an overlap is always wrong.
    pablo = await insertPerson({
      displayName: "Pablo Sosa",
      bambooId: "213",
      hireDate: "2019-01-01",
    });
    const pabloFirst = await employmentIdOf(pablo);
    const [pabloSecond] = await db
      .insert(employment)
      .values({
        personId: pablo,
        hireDate: "2021-01-01",
        status: "Active",
        sourceSystem: "bamboo_api",
        sourceId: "213b",
      })
      .returning({ id: employment.id });
    await insertJob({
      personId: pablo,
      validFrom: "2020-01-01",
      validTo: "2021-06-01",
      managerPersonId: ana,
      employmentId: pabloFirst,
    });
    pabloOverlapRow = await insertJob({
      personId: pablo,
      validFrom: "2021-01-01",
      managerPersonId: ana,
      employmentId: pabloSecond.id,
    });

    // Starts in the future: current only once "today" gets past 2030.
    quique = await insertPerson({ displayName: "Quique Paz", bambooId: "214" });
    await insertJob({ personId: quique, validFrom: "2030-01-01" });

    // Active until his termination date (2025-01-01), job row never closed.
    ramiro = await insertPerson({
      displayName: "Ramiro Vera",
      bambooId: "215",
      hireDate: "2019-01-01",
      terminationDate: "2025-01-01",
    });
    ramiroRow = await insertJob({
      personId: ramiro,
      validFrom: "2019-01-01",
      managerPersonId: ana,
    });

    // Rehire: the gap between the two employments is expected.
    gus = await insertPerson({
      displayName: "Gus Vega",
      bambooId: "204",
      hireDate: "2018-01-01",
      terminationDate: "2019-12-31",
      status: "Inactive",
    });
    const gusFirst = await employmentIdOf(gus);
    await insertJob({
      personId: gus,
      validFrom: "2018-01-01",
      validTo: "2020-01-01",
      managerPersonId: ana,
      employmentId: gusFirst,
    });
    // Second employment (the person is active again).
    const [second] = await db
      .insert(employment)
      .values({
        personId: gus,
        hireDate: "2022-01-01",
        status: "Active",
        sourceSystem: "bamboo_api",
        sourceId: "204b",
      })
      .returning({ id: employment.id });
    await insertJob({
      personId: gus,
      validFrom: "2022-01-01",
      managerPersonId: ana,
      employmentId: second.id,
    });

    hugo = await insertPerson({
      displayName: "Hugo Paz",
      bambooId: "205",
      hireDate: "2019-01-01",
      terminationDate: "2023-01-01",
      status: "Inactive",
    });
    hugoRow = await insertJob({
      personId: hugo,
      validFrom: "2019-01-01",
      managerPersonId: ana,
    });

    ines = await insertPerson({
      displayName: "Inés Mora",
      bambooId: "206",
      employmentDeleted: true,
    });
    inesRow = await insertJob({
      personId: ines,
      validFrom: "2019-01-01",
      managerPersonId: ana,
    });
    goalOfInes = await insertGoal(ines, "Meta de Inés");
    await insertGoal(ines, "Meta borrada", { deleted: true });
    await insertGoal(bruno, "Meta de Bruno");

    maria1 = await insertPerson({
      displayName: "María López",
      bambooId: "207",
    });
    maria2 = await insertPerson({
      displayName: "Lopez, Maria",
      bambooId: "208",
    });
    await insertPerson({
      displayName: "Maria López",
      bambooId: "209",
      terminationDate: "2020-01-01",
      status: "Inactive",
    });
    for (const p of [maria1, maria2]) {
      await insertJob({
        personId: p,
        validFrom: "2020-01-01",
        managerPersonId: ana,
      });
    }

    ghostManagerless = await insertPerson({
      displayName: "Zoe Sola",
      bambooId: "210",
    });
    await insertJob({
      personId: ghostManagerless,
      validFrom: "2020-01-01",
      managerRaw: "Nadie, Alguien",
    });

    const run = await insertRun({
      status: "succeeded",
      startedAt: daysAgo(20),
    });
    issueOpen = await insertIdentityIssue({
      runId: run,
      sourceId: "900",
      displayName: "Sin Resolver",
    });
    await insertIdentityIssue({
      runId: run,
      sourceId: "901",
      status: "resolved",
    });

    failedRecent = await insertRun({
      status: "error",
      startedAt: daysAgo(2),
      error: "boom",
    });
    await insertRun({ status: "error", startedAt: daysAgo(10), error: "old" });
    await insertRun({ status: "succeeded", startedAt: daysAgo(1) });

    cycleA = await insertCycle("Ciclo A");
    cycleB = await insertCycle("Ciclo B");
    partNoManager = await insertParticipant({
      cycleId: cycleA,
      personId: bruno,
    });
    const partOk = await insertParticipant({
      cycleId: cycleA,
      personId: carla,
      snapManagerPersonId: ana,
    });
    const partRemoved = await insertParticipant({
      cycleId: cycleB,
      personId: eli,
      removed: true, // removed participants do not count
    });
    partIncomplete = await insertParticipant({
      cycleId: cycleB,
      personId: fede,
      snapManagerPersonId: ana,
      snapDepartment: null,
    });

    // Review requests: the review module sets `reviewer_mismatch` on a manager
    // request submitted by someone who is no longer the snapshot manager.
    const request = (
      participantId: string,
      reviewerPersonId: string,
      relationship: "self" | "manager" | "peer" | "upward",
      extra: { deleted?: boolean; reviewerMismatch?: boolean } = {},
    ) =>
      insertReviewRequest({
        cycleId: cycleA,
        participantId,
        reviewerPersonId,
        relationship,
        ...extra,
      });
    mismatchRequest = await request(partOk, bruno, "manager", {
      reviewerMismatch: true,
    });
    await request(partOk, ana, "manager"); // not flagged
    await request(partOk, carla, "self");
    await request(partOk, dora, "manager", {
      reviewerMismatch: true,
      deleted: true,
    });
    await insertReviewRequest({
      cycleId: cycleB,
      participantId: partRemoved,
      reviewerPersonId: bruno,
      relationship: "manager",
      reviewerMismatch: true,
    }); // removed participant
  });

  it("people without a current manager: active, current row, no manager", async () => {
    const result = await peopleWithoutManager(db);
    expect(result.key).toBe("no_manager");
    expect(result.items.map((i) => [i.id, i.isTop, i.managerRaw])).toEqual([
      [ana, true, null],
      [ghostManagerless, false, "Nadie, Alguien"],
    ]);
    expect(result.count).toBe(2);
  });

  it("participants without a snapshot manager, per cycle, ignoring removed ones", async () => {
    const result = await participantsWithoutSnapshotManager(db);
    expect(result.key).toBe("participants_no_manager");
    expect(
      result.items.map((i) => [i.id, i.cycleId, i.cycleName, i.personId]),
    ).toEqual([[partNoManager, cycleA, "Ciclo A", bruno]]);
    expect(result.count).toBe(1);
  });

  it("participants whose snapshot lacks the area or the job title", async () => {
    const result = await participantsWithIncompleteSnapshot(db);
    expect(result.key).toBe("participants_incomplete_snapshot");
    expect(result.items.map((i) => [i.id, i.cycleId, i.missing])).toEqual([
      [partIncomplete, cycleB, ["department"]],
    ]);
    expect(result.count).toBe(1);
  });

  it("job history overlaps and gaps, but not the gap between employments", async () => {
    const result = await jobHistoryGapsAndOverlaps(db);
    expect(result.key).toBe("job_history_overlap_gap");
    expect(
      result.items.map((i) => [i.id, i.personId, i.kind, i.from, i.to]),
    ).toEqual([
      [overlapRow, eli, "overlap", "2021-06-01", "2022-01-01"],
      [gapRow, fede, "gap", "2021-01-01", "2021-03-01"],
      [noraGapRow, nora, "gap", "2020-06-01", "2021-01-01"],
      [pabloOverlapRow, pablo, "overlap", "2021-01-01", "2021-06-01"],
    ]);
    expect(result.count).toBe(4);
  });

  it("compares each row with the previous one of the same employment, never across rehires or unknown employments", async () => {
    const reported = (await jobHistoryGapsAndOverlaps(db)).items.map(
      (i) => i.personId,
    );
    expect(reported).not.toContain(gus); // gap between two employments
    expect(reported).not.toContain(olga); // null employment ids are distinct
    expect(reported).toContain(nora); // gap hidden by the other employment's row
  });

  it("people who left but still have an open job row", async () => {
    const result = await jobHistoryOpenAfterExit(db);
    expect(result.key).toBe("job_history_open_after_exit");
    expect(
      result.items.map((i) => [i.id, i.personId, i.terminationDate]),
    ).toEqual([
      [hugoRow, hugo, "2023-01-01"],
      // No live employment at all (soft-deleted): nobody is employed there.
      [inesRow, ines, null],
      [ramiroRow, ramiro, "2025-01-01"],
    ]);
    expect(result.count).toBe(3);
  });

  it("active people with no job history row at all", async () => {
    const result = await activeWithoutJobHistory(db);
    expect(result.key).toBe("active_without_job_history");
    expect(result.items.map((i) => i.id)).toEqual([dora]);
    expect(result.count).toBe(1);
  });

  it("goals of people without a live employment (live goals only)", async () => {
    const result = await goalsWithoutLiveEmployment(db);
    expect(result.key).toBe("goals_without_employment");
    expect(result.items.map((i) => [i.id, i.personId, i.title])).toEqual([
      [goalOfInes, ines, "Meta de Inés"],
    ]);
    expect(result.count).toBe(1);
  });

  it("duplicate display names among active people, accents and order ignored", async () => {
    const result = await duplicateDisplayNames(db);
    expect(result.key).toBe("duplicate_names");
    expect(result.items.map((i) => i.id).sort()).toEqual(
      [maria1, maria2].sort(),
    );
    expect(result.items.every((i) => i.duplicates === 2)).toBe(true);
    expect(result.count).toBe(2);
  });

  it("open identity issues only", async () => {
    const result = await openIdentityIssues(db);
    expect(result.key).toBe("identity_open");
    expect(result.items.map((i) => [i.id, i.displayName, i.sourceId])).toEqual([
      [issueOpen, "Sin Resolver", "900"],
    ]);
    expect(result.count).toBe(1);
  });

  it("ingest runs in error in the last 7 days", async () => {
    const result = await failedIngestRuns(db, { now: NOW });
    expect(result.key).toBe("failed_runs");
    expect(result.items.map((i) => [i.id, i.error])).toEqual([
      [failedRecent, "boom"],
    ]);
    expect(result.count).toBe(1);
  });

  it("flagged manager reviews (not deleted, participant not removed)", async () => {
    const result = await reviewerMismatch(db);
    expect(result.key).toBe("reviewer_mismatch");
    expect(
      result.items.map((i) => [
        i.id,
        i.cycleId,
        i.personId,
        i.reviewerPersonId,
        i.snapManagerId,
      ]),
    ).toEqual([[mismatchRequest, cycleA, carla, bruno, ana]]);
    expect(result.count).toBe(1);
  });

  it("the report lists every available indicator, each count matching its items", async () => {
    const report = await getDataQuality(db, { now: NOW });
    expect(report.map((i) => i.key)).toEqual([...DATA_QUALITY_KEYS]);
    for (const indicator of report) {
      expect(indicator.count).toBe(indicator.items.length);
      const detail = await getIndicator(db, indicator.key, { now: NOW });
      expect(detail).toEqual(indicator);
    }
    expect(report.map((i) => [i.key, i.count])).toEqual([
      ["identity_open", 1],
      ["no_manager", 2],
      ["participants_no_manager", 1],
      ["participants_incomplete_snapshot", 1],
      ["job_history_overlap_gap", 4],
      ["job_history_open_after_exit", 3],
      ["active_without_job_history", 1],
      ["goals_without_employment", 1],
      ["duplicate_names", 2],
      ["failed_runs", 1],
      ["reviewer_mismatch", 1],
    ]);
  });

  it("an unknown indicator key has no detail", async () => {
    expect(await getIndicator(db, "nope")).toBeNull();
  });
});

describe('"today" is one date everywhere', () => {
  it("a job row that starts in the future counts once `now` gets there", async () => {
    const todayRows = await peopleWithoutManager(db, { now: NOW });
    expect(todayRows.items.map((i) => i.id)).not.toContain(quique);
    const later = await peopleWithoutManager(db, {
      now: new Date("2031-01-01T12:00:00Z"),
    });
    expect(later.items.map((i) => i.id)).toContain(quique);
  });

  it("who is active follows `now` too (Ramiro's exit date is 2025-01-01)", async () => {
    const before = await jobHistoryOpenAfterExit(db, {
      now: new Date("2024-06-01T12:00:00Z"),
    });
    expect(before.items.map((i) => i.personId)).not.toContain(ramiro);
    const after = await jobHistoryOpenAfterExit(db, { now: NOW });
    expect(after.items.map((i) => i.personId)).toContain(ramiro);
  });
});

describe("after fixing the data the counts drop", () => {
  it("counts follow the data, not a cache", async () => {
    await db.execute(
      sql`UPDATE employee_job_history SET manager_person_id = ${ana}, manager_raw = null WHERE person_id = ${ghostManagerless}`,
    );
    const result = await peopleWithoutManager(db);
    expect(result.items.map((i) => i.id)).toEqual([ana]);
    expect(result.count).toBe(1);
  });
});
