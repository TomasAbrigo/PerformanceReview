import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  employment,
  identityMatchIssue,
  ingestRun,
  person,
  rawRecord,
  sourceIdentity,
} from "@/db/schema";
import { FixtureAdapter } from "./fixture-adapter";
import { runIngest } from "./run-ingest";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let dir: string;

async function reset() {
  await db.execute(
    sql`TRUNCATE source_identity, employment, person, raw_record, ingest_run, identity_match_issue CASCADE`,
  );
}

type Page = { data: Record<string, unknown>[] };

async function editPage(file: string, edit: (page: Page) => void) {
  const p = path.join(dir, file);
  const page = JSON.parse(await readFile(p, "utf8"));
  edit(page);
  await writeFile(p, JSON.stringify(page));
}

const ingest = () =>
  runIngest({ adapter: new FixtureAdapter(dir), entity: "employee", db });

describe("runIngest (employees from fixtures)", () => {
  beforeEach(async () => {
    await reset();
    dir = await mkdtemp(path.join(tmpdir(), "ingest-"));
    await cp(FIXTURES, dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("creates a person, identities and employment per employee", async () => {
    const { counts, runId } = await ingest();

    expect(counts).toEqual({
      read: 3,
      inserted: 3,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      deleted: 0,
      issues: 0,
    });
    expect(await db.select().from(person)).toHaveLength(3);
    expect(await db.select().from(rawRecord)).toHaveLength(3);

    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run).toMatchObject({
      status: "succeeded",
      sourceSystem: "bamboo_api",
      counts,
    });
    expect(run.finishedAt).toBeInstanceOf(Date);

    const ids = await db
      .select({ kind: sourceIdentity.kind, value: sourceIdentity.value })
      .from(sourceIdentity)
      .innerJoin(person, eq(person.id, sourceIdentity.personId))
      .where(eq(person.displayName, "Bruno Pérez"));
    expect(ids).toEqual(
      expect.arrayContaining([
        { kind: "bamboo_id", value: "102" },
        { kind: "employee_number", value: "0002" },
        { kind: "work_email", value: "bruno.perez@example.com" },
      ]),
    );
  });

  it("is idempotent: a re-run inserts and updates nothing", async () => {
    await ingest();
    const { counts, runId } = await ingest();

    expect(counts).toEqual({
      read: 3,
      inserted: 0,
      updated: 0,
      unchanged: 3,
      rejected: 0,
      deleted: 0,
      issues: 0,
    });
    expect(await db.select().from(person)).toHaveLength(3);
    expect(await db.select().from(rawRecord)).toHaveLength(3);
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.counts).toEqual(counts);
  });

  it("one changed field produces exactly one update", async () => {
    await ingest();
    await editPage("employees-page-1.json", (page) => {
      page.data[1].workEmail = "bruno.p@example.com";
    });

    const { counts } = await ingest();

    expect(counts).toMatchObject({ updated: 1, unchanged: 2, inserted: 0 });
    const [bruno] = await db
      .select()
      .from(person)
      .where(eq(person.displayName, "Bruno Pérez"));
    expect(bruno.workEmail).toBe("bruno.p@example.com");
    const emails = await db
      .select()
      .from(sourceIdentity)
      .where(eq(sourceIdentity.personId, bruno.id));
    const current = emails.filter(
      (i) => i.kind === "work_email" && i.validTo === null,
    );
    expect(current.map((i) => i.value)).toEqual(["bruno.p@example.com"]);
    expect(
      emails.find((i) => i.value === "bruno.perez@example.com")?.validTo,
    ).toBeInstanceOf(Date);
  });

  it("keys on the Bamboo internal id, never on employeeNumber", async () => {
    await ingest();
    // Legajo edited in Bamboo: same internal id → same person, updated.
    await editPage("employees-page-1.json", (page) => {
      page.data[0].employeeNumber = "9999";
    });
    const second = await ingest();
    expect(second.counts).toMatchObject({ inserted: 0, updated: 1 });

    // Another internal id reusing an old legajo is a new person.
    await editPage("employees-page-2.json", (page) => {
      page.data.push({
        ...page.data[0],
        id: 104,
        employeeNumber: "0001",
        displayName: "Diego Sosa",
        workEmail: "diego.sosa@example.com",
      });
    });
    const third = await ingest();
    expect(third.counts).toMatchObject({ inserted: 1 });
    expect(await db.select().from(person)).toHaveLength(4);

    const rows = await db.select().from(employment);
    expect(rows.map((r) => r.sourceId).sort()).toEqual([
      "101",
      "102",
      "103",
      "104",
    ]);
  });

  it("records the termination date of a terminated employee", async () => {
    await ingest();
    const [carla] = await db
      .select()
      .from(employment)
      .where(eq(employment.sourceId, "103"));
    expect(carla).toMatchObject({
      terminationDate: "2024-06-30",
      status: "Inactive",
    });
  });

  it("rejects records that fail staging and logs them on the run", async () => {
    await editPage("employees-page-2.json", (page) => {
      page.data.push({ id: 105, displayName: null, firstName: null });
    });

    const { counts, runId } = await ingest();

    expect(counts).toMatchObject({ read: 4, inserted: 3, rejected: 1 });
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.rejects).toEqual([
      { sourceId: "105", reason: expect.any(String) },
    ]);
  });

  async function openIdentities(displayName: string) {
    return db
      .select({ kind: sourceIdentity.kind, value: sourceIdentity.value })
      .from(sourceIdentity)
      .innerJoin(person, eq(person.id, sourceIdentity.personId))
      .where(
        and(
          eq(person.displayName, displayName),
          isNull(sourceIdentity.validTo),
        ),
      );
  }

  it("lets a new employee take over a legajo that was released", async () => {
    await ingest();
    await editPage("employees-page-1.json", (page) => {
      page.data[0].employeeNumber = "9999";
    });
    await ingest();
    await editPage("employees-page-2.json", (page) => {
      page.data.push({
        ...page.data[0],
        id: 104,
        employeeNumber: "0001",
        displayName: "Diego Sosa",
        workEmail: "diego.sosa@example.com",
      });
    });
    await ingest();

    expect(await openIdentities("Diego Sosa")).toContainEqual({
      kind: "employee_number",
      value: "0001",
    });
  });

  it("handles an email going A → B → A", async () => {
    await ingest();
    const setEmail = (email: string) =>
      editPage("employees-page-1.json", (page) => {
        page.data[1].workEmail = email;
      });
    await setEmail("bruno.b@example.com");
    await ingest();
    await setEmail("bruno.perez@example.com");
    const { counts } = await ingest();

    expect(counts).toMatchObject({ updated: 1 });
    const emails = (await openIdentities("Bruno Pérez")).filter(
      (i) => i.kind === "work_email",
    );
    expect(emails).toEqual([
      { kind: "work_email", value: "bruno.perez@example.com" },
    ]);
  });

  it("queues an identity conflict when two active employees share an email, keeping the holder's", async () => {
    await ingest();
    await editPage("employees-page-1.json", (page) => {
      page.data[1].workEmail = "ana.garcia@example.com";
    });

    const { runId } = await ingest();

    expect(await openIdentities("Ana García")).toContainEqual({
      kind: "work_email",
      value: "ana.garcia@example.com",
    });
    // Bruno keeps his previous email open rather than ending with none.
    expect(await openIdentities("Bruno Pérez")).toContainEqual({
      kind: "work_email",
      value: "bruno.perez@example.com",
    });
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.rejects).toEqual([]);
    expect(run.counts).toMatchObject({ issues: 1 });
    const queued = await db.select().from(identityMatchIssue);
    expect(queued).toMatchObject([
      { sourceId: "102", reason: "conflict", status: "open" },
    ]);
  });

  it("soft-deletes employments missing from a full extraction", async () => {
    await ingest();
    await editPage("employees-page-2.json", (page) => {
      page.data = [];
    });
    await rm(path.join(dir, "employee-103.json"));

    const { counts } = await ingest();

    expect(counts).toMatchObject({ read: 2, deleted: 1 });
    const [carla] = await db
      .select()
      .from(employment)
      .where(eq(employment.sourceId, "103"));
    expect(carla.deletedAt).toBeInstanceOf(Date);
  });

  it("keeps both periods when a terminated employee is rehired under the same id", async () => {
    await editPage("employees-page-2.json", (page) => {
      page.data[0].hireDate = "2018-01-10";
    });
    await ingest();
    await editPage("employees-page-2.json", (page) => {
      Object.assign(page.data[0], {
        hireDate: "2025-02-01",
        terminationDate: null,
        status: "Active",
      });
    });

    await ingest();

    const periods = await db
      .select()
      .from(employment)
      .where(eq(employment.sourceId, "103"))
      .orderBy(employment.hireDate);
    expect(
      periods.map((p) => [p.hireDate, p.terminationDate, p.status]),
    ).toEqual([
      ["2018-01-10", "2024-06-30", "Inactive"],
      ["2025-02-01", null, "Active"],
    ]);
    expect(new Set(periods.map((p) => p.personId)).size).toBe(1);
  });
});
