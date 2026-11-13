import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  employeeJobHistory,
  employment,
  goal,
  goalMilestone,
  person,
  ratingScale,
  sourceIdentity,
} from "@/db/schema";
import { generateCompany } from "@/fixtures/company";
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

const company = generateCompany({ size: "small", seed: FIXTURE_SEEDS.small });
const records = company.employees;
const active = new Set(
  records.filter((e) => e.status === "Active").map((e) => e.id),
);
// The goal pipeline reads the goals of the active employees (#6): those of
// someone who left are not in Bamboo's reach.
const readableGoals = company.goals.filter((g) => active.has(g.employeeId));

async function total(table: PgTable): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(table);
  return n;
}

describe("seedFromFixtures (small)", () => {
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

  it("first run inserts everything it read and rejects nothing", () => {
    for (const run of first) {
      expect(run.counts.read).toBeGreaterThan(0);
      expect(run.counts).toMatchObject({
        inserted: run.counts.read,
        updated: 0,
        unchanged: 0,
        rejected: 0,
      });
    }
  });

  it("leaves one person per Bamboo record: the 40 of the small company", async () => {
    expect(records).toHaveLength(40);
    expect(first[0].counts.read).toBe(records.length);
    expect(await total(person)).toBe(records.length);
    expect(await total(employment)).toBe(records.length);
    // Ground truth: a perfect resolver would merge the rehires (a new Bamboo
    // id for the same human) and leave fewer persons. Identity resolution
    // does not exist yet (#5), so each Bamboo id is still its own person.
    expect(company.identity.persons.length).toBeLessThan(records.length);
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
      records.map((e) => e.id).sort(),
    );
  });

  it("builds the job history of every employee and resolves each current manager", async () => {
    expect(await total(employeeJobHistory)).toBe(company.jobHistory.length);

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
    for (const e of records) {
      const row = latest.get(idOf.get(e.id)!);
      expect(row, `job history of employee ${e.id}`).toBeDefined();
      // Current manager = the employee's supervisorEId. Older rows only have
      // the reportsTo NAME ("Last, First"): they stay unresolved until the
      // identity module matches names.
      expect(row!.managerPersonId).toBe(
        e.managerId === null ? null : idOf.get(e.managerId),
      );
    }
    const resolved = rows.filter((r) => r.managerPersonId !== null).length;
    expect(resolved).toBeGreaterThan(rows.length / 2);
  });

  it("stores the goals of the active employees, with milestones and comment counts", async () => {
    expect(first[2].counts.read).toBe(readableGoals.length);
    expect(await total(goal)).toBe(readableGoals.length);
    const [{ comments }] = await db
      .select({ comments: sql<number>`sum(${goal.commentCount})::int` })
      .from(goal);
    expect(comments).toBe(
      readableGoals.reduce((sum, g) => sum + g.commentCount, 0),
    );
    expect(await total(goalMilestone)).toBe(
      readableGoals.reduce((sum, g) => sum + (g.milestones?.length ?? 0), 0),
    );
  });

  it("is idempotent: a second run finds everything unchanged", () => {
    expect(second.map((r) => r.entity)).toEqual(first.map((r) => r.entity));
    for (const [i, run] of second.entries()) {
      expect(run.counts).toMatchObject({
        read: first[i].counts.read,
        inserted: 0,
        updated: 0,
        unchanged: first[i].counts.read,
        rejected: 0,
      });
    }
  });
});

describe("seedFromFixtures (demo)", () => {
  afterAll(async () => {
    await resetDomainTables(db);
    await closeDb();
  });

  it("leaves the 400 people of the demo company and is idempotent too", async () => {
    const demo = generateCompany({ size: "demo", seed: FIXTURE_SEEDS.demo });
    const demoActive = new Set(
      demo.employees.filter((e) => e.status === "Active").map((e) => e.id),
    );
    await resetDomainTables(db);

    const first = await seedFromFixtures({ size: "demo", db });
    const second = await seedFromFixtures({ size: "demo", db });

    expect(demo.employees).toHaveLength(400);
    expect(await total(person)).toBe(400);
    expect(await total(employeeJobHistory)).toBe(demo.jobHistory.length);
    expect(await total(goal)).toBe(
      demo.goals.filter((g) => demoActive.has(g.employeeId)).length,
    );
    expect(first.map((r) => r.counts.rejected)).toEqual([0, 0, 0]);
    for (const [i, run] of second.entries()) {
      expect(run.counts).toMatchObject({
        read: first[i].counts.read,
        unchanged: first[i].counts.read,
        inserted: 0,
        updated: 0,
        rejected: 0,
      });
    }
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
    await resetDomainTables(db);
    const runs = await seedFromFixtures({ size: "small", db });
    expect(runs.map((r) => r.counts.inserted)).toEqual(
      runs.map((r) => r.counts.read),
    );
    expect(await total(person)).toBe(company.employees.length);
    await resetDomainTables(db);
  });
});
