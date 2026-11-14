import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cycleParticipant,
  employeeJobHistory,
  employment,
  goal,
  identityMatchIssue,
  ingestRun,
  person,
  reviewCycle,
  reviewRequest,
  sourceIdentity,
  type IdentityIssueStatus,
  type IngestCounts,
  type IngestReject,
  type IngestRunStatus,
} from "@/db/schema";
import { FixtureAdapter, runIngest } from "@/modules/ingest";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

/** Empties everything the analytics/API/export DB tests touch. */
export async function resetAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE review_cycle, goal_share, goal_comment, goal_milestone, goal, identity_match_issue, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run, sync_state CASCADE`,
  );
}

/** The three-person Bamboo fixture company (Ana CEO, Bruno, Carla left in 2024). */
export async function ingestFixtureCompany(): Promise<{
  ana: string;
  bruno: string;
  carla: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "analytics-"));
  try {
    await cp(FIXTURES, dir, { recursive: true });
    const adapter = new FixtureAdapter(dir);
    await runIngest({ adapter, entity: "employee", db });
    await runIngest({ adapter, entity: "job_history", db });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const idOf = async (name: string) =>
    (
      await db
        .select({ id: person.id })
        .from(person)
        .where(eq(person.displayName, name))
    )[0].id;
  return {
    ana: await idOf("Ana García"),
    bruno: await idOf("Bruno Pérez"),
    carla: await idOf("Carla Romero"),
  };
}

export type NewPerson = {
  displayName: string;
  workEmail?: string | null;
  /** Bamboo employee id: adds an open bamboo_id identity and the employment. */
  bambooId?: string;
  employeeNumber?: string;
  hireDate?: string | null;
  terminationDate?: string | null;
  status?: string;
  /** Soft-deleted employment: the person has no live employment. */
  employmentDeleted?: boolean;
  /** No employment row at all. */
  noEmployment?: boolean;
};

/** A person with one employment (active by default) and its source identities. */
export async function insertPerson(p: NewPerson): Promise<string> {
  const [row] = await db
    .insert(person)
    .values({ displayName: p.displayName, workEmail: p.workEmail ?? null })
    .returning({ id: person.id });
  const id = row.id;
  if (p.bambooId) {
    await db.insert(sourceIdentity).values({
      personId: id,
      sourceSystem: "bamboo_api",
      kind: "bamboo_id",
      value: p.bambooId,
    });
  }
  if (p.employeeNumber) {
    await db.insert(sourceIdentity).values({
      personId: id,
      sourceSystem: "bamboo_api",
      kind: "employee_number",
      value: p.employeeNumber,
    });
  }
  if (!p.noEmployment) {
    await db.insert(employment).values({
      personId: id,
      hireDate: p.hireDate === undefined ? "2020-01-01" : p.hireDate,
      terminationDate: p.terminationDate ?? null,
      status: p.status ?? "Active",
      sourceSystem: "bamboo_api",
      sourceId: p.bambooId ?? null,
      deletedAt: p.employmentDeleted ? new Date() : null,
    });
  }
  return id;
}

export type NewJob = {
  personId: string;
  validFrom: string;
  validTo?: string | null;
  managerPersonId?: string | null;
  managerRaw?: string | null;
  department?: string | null;
  division?: string | null;
  jobTitle?: string | null;
  location?: string | null;
  employmentId?: string | null;
};

export async function insertJob(j: NewJob): Promise<string> {
  const [row] = await db
    .insert(employeeJobHistory)
    .values({
      personId: j.personId,
      employmentId: j.employmentId ?? null,
      validFrom: j.validFrom,
      validTo: j.validTo ?? null,
      managerPersonId: j.managerPersonId ?? null,
      managerRaw: j.managerRaw ?? null,
      department: j.department === undefined ? "Tecnología" : j.department,
      division: j.division ?? null,
      jobTitle: j.jobTitle === undefined ? "Developer" : j.jobTitle,
      location: j.location ?? null,
      sourceSystem: "bamboo_api",
      sourceId: `job-${j.personId.slice(0, 8)}-${j.validFrom}`,
    })
    .returning({ id: employeeJobHistory.id });
  return row.id;
}

/** The (single) live employment of a person. */
export async function employmentIdOf(personId: string): Promise<string> {
  const [row] = await db
    .select({ id: employment.id })
    .from(employment)
    .where(eq(employment.personId, personId));
  return row.id;
}

export async function insertGoal(
  personId: string,
  title: string,
  extra: { deleted?: boolean; sourceId?: string; dueDate?: string } = {},
): Promise<string> {
  const [row] = await db
    .insert(goal)
    .values({
      personId,
      title,
      sourceSystem: "bamboo_api",
      sourceId: extra.sourceId ?? `goal-${title}`,
      dueDate: extra.dueDate ?? null,
      deletedAt: extra.deleted ? new Date() : null,
    })
    .returning({ id: goal.id });
  return row.id;
}

export async function insertRun(r: {
  status: IngestRunStatus;
  startedAt: Date;
  entity?: string;
  error?: string;
  counts?: Partial<IngestCounts>;
  rejects?: IngestReject[];
}): Promise<string> {
  const [row] = await db
    .insert(ingestRun)
    .values({
      sourceSystem: "bamboo_api",
      adapter: "fixture",
      entity: r.entity ?? "employee",
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.status === "running" ? null : r.startedAt,
      error: r.error ?? null,
      params: { entity: r.entity ?? "employee" },
      counts: r.counts ?? null,
      rejects: r.rejects ?? null,
    })
    .returning({ id: ingestRun.id });
  return row.id;
}

export async function insertIdentityIssue(r: {
  runId: string;
  sourceId: string;
  status?: IdentityIssueStatus;
  displayName?: string;
}): Promise<string> {
  const [row] = await db
    .insert(identityMatchIssue)
    .values({
      ingestRunId: r.runId,
      sourceSystem: "bamboo_api",
      entity: "employee",
      sourceId: r.sourceId,
      payload: { id: r.sourceId, displayName: r.displayName ?? "Alguien" },
      payloadHash: `hash-${r.sourceId}`,
      reason: "ambiguous",
      status: r.status ?? "open",
    })
    .returning({ id: identityMatchIssue.id });
  return row.id;
}

export async function insertCycle(name: string): Promise<string> {
  const [row] = await db
    .insert(reviewCycle)
    .values({
      name,
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
      snapshotDate: "2025-06-01",
      components: {
        self: true,
        manager: true,
        peer: false,
        upward: false,
        calibration: false,
      },
      anonymity: { peer: "transparent", upward: "transparent" },
    })
    .returning({ id: reviewCycle.id });
  return row.id;
}

export async function insertParticipant(p: {
  cycleId: string;
  personId: string;
  snapManagerPersonId?: string | null;
  snapDepartment?: string | null;
  snapJobTitle?: string | null;
  removed?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(cycleParticipant)
    .values({
      cycleId: p.cycleId,
      revieweePersonId: p.personId,
      snapshotAsOf: "2025-06-01",
      snapManagerPersonId: p.snapManagerPersonId ?? null,
      snapDepartment:
        p.snapDepartment === undefined ? "Tecnología" : p.snapDepartment,
      snapJobTitle: p.snapJobTitle === undefined ? "Developer" : p.snapJobTitle,
      removedAt: p.removed ? new Date() : null,
    })
    .returning({ id: cycleParticipant.id });
  return row.id;
}

export async function insertReviewRequest(r: {
  cycleId: string;
  participantId: string;
  reviewerPersonId: string;
  relationship: "self" | "manager" | "peer" | "upward";
  deleted?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(reviewRequest)
    .values({
      cycleId: r.cycleId,
      participantId: r.participantId,
      reviewerPersonId: r.reviewerPersonId,
      relationship: r.relationship,
      deletedAt: r.deleted ? new Date() : null,
    })
    .returning({ id: reviewRequest.id });
  return row.id;
}
