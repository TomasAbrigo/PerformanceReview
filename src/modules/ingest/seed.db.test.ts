import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  employeeJobHistory,
  employment,
  goal,
  goalMilestone,
  identityMatchIssue,
  person,
  ratingScale,
  sourceIdentity,
} from "@/db/schema";
import { generateCompany, type CompanyFixture } from "@/fixtures/company";
import { FIXTURE_SEEDS } from "@/fixtures/write";
import { seedSystemTemplates } from "@/modules/templates";
import { REGISTRY } from "./registry";
import {
  KEPT_TABLES,
  RESET_TABLES,
  resetDomainTables,
  seedFromFixtures,
  type SeedRun,
} from "./seed";

/**
 * What the pipelines should leave for a company, from the generator's ground
 * truth. Bamboo gives a rehire a NEW id with the same legajo (and mostly the
 * same email): the identity module never links that on its own, it queues it
 * for a human (#5). So the persons are the ground-truth persons (one per
 * human), the later ids of the rehires wait in the queue, and until someone
 * resolves them they have no job history and no goals.
 */
function expected(company: CompanyFixture) {
  const queued = new Set(
    company.identity.persons.flatMap((p) => p.employeeIds.slice(1)),
  );
  const ingested = company.employees.filter((e) => !queued.has(e.id));
  const ingestedIds = new Set(ingested.map((e) => e.id));
  // The goal pipeline reads the goals of the active employees (#6): those of
  // someone who left are not in Bamboo's reach.
  const activeIds = new Set(
    ingested.filter((e) => e.status === "Active").map((e) => e.id),
  );
  return {
    records: company.employees.length,
    queued,
    ingested,
    persons: company.identity.persons.length,
    jobRows: company.jobHistory.filter((r) => ingestedIds.has(r.employeeId)),
    goals: company.goals.filter((g) => activeIds.has(g.employeeId)),
  };
}

async function total(table: PgTable): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(table);
  return n;
}

/** What a run did, to compare a second run against the first. */
function pipelineChecks(
  want: ReturnType<typeof expected>,
  first: SeedRun[],
  second: SeedRun[],
) {
  const [employee, jobHistory, goals] = first;
  expect(employee.counts).toMatchObject({
    read: want.records,
    inserted: want.persons,
    unchanged: 0,
    rejected: 0,
    issues: want.queued.size,
  });
  // job_history of a queued id has no person to attach to yet.
  expect(jobHistory.counts).toMatchObject({
    read: want.records,
    inserted: want.persons,
    rejected: want.queued.size,
  });
  expect(goals.counts).toMatchObject({
    read: want.goals.length,
    inserted: want.goals.length,
    rejected: 0,
  });
  for (const [i, run] of second.entries()) {
    // Nothing is inserted or updated again: what was applied is unchanged and
    // what waited still waits.
    expect(run.counts).toMatchObject({
      read: first[i].counts.read,
      inserted: 0,
      updated: 0,
      unchanged: first[i].counts.inserted,
      rejected: first[i].counts.rejected,
    });
    expect(run.issues).toBe(first[i].issues);
  }
}

describe("seedFromFixtures (small)", () => {
  const company = generateCompany({ size: "small", seed: FIXTURE_SEEDS.small });
  const want = expected(company);
  let first: SeedRun[];
  let second: SeedRun[];

  beforeAll(async () => {
    await resetDomainTables(db);
    first = await seedFromFixtures({ size: "small", db });
    second = await seedFromFixtures({ size: "small", db });
  });
  afterAll(async () => {
    await resetDomainTables(db);
    await closeDb();
  });

  it("runs every registered pipeline, in registry order", () => {
    expect(first.map((r) => r.entity)).toEqual([...REGISTRY.keys()]);
    expect(first.map((r) => r.entity)).toEqual([
      "employee",
      "job_history",
      "goal",
    ]);
  });

  it("reads the 40 Bamboo records and leaves the 36 persons they are", async () => {
    expect(want.records).toBe(40);
    expect(want.persons).toBe(36);
    expect(await total(person)).toBe(want.persons);
    expect(await total(employment)).toBe(want.persons);
    const bambooIds = await db
      .select({ value: sourceIdentity.value })
      .from(sourceIdentity)
      .where(
        and(
          eq(sourceIdentity.kind, "bamboo_id"),
          isNull(sourceIdentity.validTo),
        ),
      );
    expect(bambooIds.map((r) => r.value).sort()).toEqual(
      want.ingested.map((e) => e.id).sort(),
    );
  });

  it("holds the 4 rehires in the identity queue instead of guessing", async () => {
    expect(want.queued.size).toBe(4);
    const issues = await db.select().from(identityMatchIssue);
    expect(issues.map((i) => i.sourceId).sort()).toEqual(
      [...want.queued].sort(),
    );
    for (const issue of issues) {
      expect(issue).toMatchObject({ status: "open", reason: "ambiguous" });
    }
  });

  it("builds the job history of every ingested employee and resolves each current manager", async () => {
    expect(await total(employeeJobHistory)).toBe(want.jobRows.length);

    const idOf = new Map(
      (
        await db
          .select({
            value: sourceIdentity.value,
            personId: sourceIdentity.personId,
          })
          .from(sourceIdentity)
          .where(eq(sourceIdentity.kind, "bamboo_id"))
      ).map((r) => [r.value, r.personId]),
    );
    const rows = await db.select().from(employeeJobHistory);
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const best = latest.get(r.personId);
      if (!best || r.validFrom > best.validFrom) latest.set(r.personId, r);
    }
    for (const e of want.ingested) {
      const row = latest.get(idOf.get(e.id)!);
      expect(row, `job history of employee ${e.id}`).toBeDefined();
      // Current manager = the employee's supervisorEId. Older rows only have
      // the reportsTo NAME ("Last, First"): they stay unresolved.
      expect(row!.managerPersonId).toBe(
        e.managerId === null ? null : (idOf.get(e.managerId) ?? null),
      );
    }
    const resolved = rows.filter((r) => r.managerPersonId !== null).length;
    expect(resolved).toBeGreaterThan(rows.length / 2);
  });

  it("stores the goals of the active employees, with milestones and comment counts", async () => {
    expect(await total(goal)).toBe(want.goals.length);
    const [{ comments }] = await db
      .select({ comments: sql<number>`sum(${goal.commentCount})::int` })
      .from(goal);
    expect(comments).toBe(
      want.goals.reduce((sum, g) => sum + g.commentCount, 0),
    );
    expect(await total(goalMilestone)).toBe(
      want.goals.reduce((sum, g) => sum + (g.milestones?.length ?? 0), 0),
    );
  });

  it("is idempotent: a second run inserts and updates nothing", () => {
    expect(second.map((r) => r.entity)).toEqual(first.map((r) => r.entity));
    pipelineChecks(want, first, second);
  });
});

describe("seedFromFixtures (demo)", () => {
  afterAll(async () => {
    await resetDomainTables(db);
    await closeDb();
  });

  it("leaves the demo company (400 records) and is idempotent too", async () => {
    const company = generateCompany({ size: "demo", seed: FIXTURE_SEEDS.demo });
    const want = expected(company);
    await resetDomainTables(db);

    const first = await seedFromFixtures({ size: "demo", db });
    const second = await seedFromFixtures({ size: "demo", db });

    expect(want.records).toBe(400);
    expect(await total(person)).toBe(want.persons);
    expect(await total(identityMatchIssue)).toBe(want.queued.size);
    expect(await total(employeeJobHistory)).toBe(want.jobRows.length);
    expect(await total(goal)).toBe(want.goals.length);
    pipelineChecks(want, first, second);
  }, 120_000);
});

describe("resetDomainTables", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("classifies every table: either emptied by the seed or deliberately kept", async () => {
    const rows = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const tables = (rows as unknown as { tablename: string }[]).map(
      (r) => r.tablename,
    );
    expect([...RESET_TABLES, ...KEPT_TABLES].sort()).toEqual(tables.sort());
  });

  it("empties the ingested data and leaves the settings alone", async () => {
    await seedSystemTemplates(db);
    await seedFromFixtures({ size: "small", db });
    const scales = await total(ratingScale);
    expect(scales).toBeGreaterThan(0);

    await resetDomainTables(db);

    for (const table of RESET_TABLES) {
      const [{ n }] = (await db.execute(
        sql.raw(`select count(*)::int as n from "${table}"`),
      )) as unknown as { n: number }[];
      expect(n, table).toBe(0);
    }
    expect(await total(ratingScale)).toBe(scales);
  });

  it("seeds again after a reset, with the same result as the first time", async () => {
    const company = generateCompany({
      size: "small",
      seed: FIXTURE_SEEDS.small,
    });
    await resetDomainTables(db);
    const [employees] = await seedFromFixtures({ size: "small", db });
    expect(employees.counts.inserted).toBe(company.identity.persons.length);
    expect(await total(person)).toBe(company.identity.persons.length);
    await resetDomainTables(db);
  });
});
