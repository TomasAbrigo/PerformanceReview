import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  employeeJobHistory,
  employeeStatusHistory,
  ingestRun,
  person,
} from "@/db/schema";
import { FixtureAdapter } from "./fixture-adapter";
import { runIngest } from "./run-ingest";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let dir: string;

async function reset() {
  await db.execute(
    sql`TRUNCATE employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

async function editJson<T>(file: string, edit: (body: T) => void) {
  const p = path.join(dir, file);
  const body = JSON.parse(await readFile(p, "utf8")) as T;
  edit(body);
  await writeFile(p, JSON.stringify(body));
}

const ingest = (entity: "employee" | "job_history") =>
  runIngest({ adapter: new FixtureAdapter(dir), entity, db });

async function personId(name: string) {
  const [p] = await db
    .select({ id: person.id })
    .from(person)
    .where(eq(person.displayName, name));
  return p.id;
}

const historyOf = async (id: string) =>
  db
    .select()
    .from(employeeJobHistory)
    .where(eq(employeeJobHistory.personId, id))
    .orderBy(asc(employeeJobHistory.validFrom));

describe("runIngest job_history (jobInfo + employmentStatus fixtures)", () => {
  beforeEach(async () => {
    await reset();
    dir = await mkdtemp(path.join(tmpdir(), "ingest-jh-"));
    await cp(FIXTURES, dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  it("builds one SCD2 row per change with chained valid_to", async () => {
    await ingest("employee");
    const { counts, runId } = await ingest("job_history");

    expect(counts).toMatchObject({
      read: 3,
      inserted: 3,
      rejected: 0,
      managerUnresolved: 0,
    });
    const [ana, bruno, carla] = await Promise.all([
      personId("Ana García"),
      personId("Bruno Pérez"),
      personId("Carla Romero"),
    ]);

    // Same-day double change (rows 4 and 5) keeps row 5; row 6 is identical
    // to it and collapses.
    const b = await historyOf(bruno);
    expect(
      b.map((r) => [
        r.validFrom,
        r.validTo,
        r.jobTitle,
        r.managerPersonId,
        r.managerRaw,
        r.sourceId,
      ]),
    ).toEqual([
      ["2021-07-15", "2023-01-01", "Developer", carla, "Carla Romero", "3"],
      ["2023-01-01", null, "Senior Developer", ana, "Ana García", "5"],
    ]);
    expect(b[0]).toMatchObject({
      sourceSystem: "bamboo_api",
      ingestRunId: runId,
      department: "Ingeniería",
      division: "Corporativo",
      location: "Rosario",
    });
    expect(b[0].employmentId).not.toBeNull();

    // Terminated 2024-06-30: the open row closes the day after.
    const c = await historyOf(carla);
    expect(c.map((r) => [r.validFrom, r.validTo, r.managerPersonId])).toEqual([
      ["2018-05-01", "2024-07-01", ana],
    ]);

    const a = await historyOf(ana);
    expect(a.map((r) => [r.validTo, r.managerPersonId])).toEqual([
      [null, null],
    ]);

    const statuses = await db
      .select()
      .from(employeeStatusHistory)
      .where(eq(employeeStatusHistory.personId, carla))
      .orderBy(asc(employeeStatusHistory.validFrom));
    expect(
      statuses.map((s) => [s.employmentStatus, s.validFrom, s.validTo]),
    ).toEqual([
      ["Full-Time", "2018-05-01", "2024-06-30"],
      ["Terminated", "2024-06-30", null],
    ]);
    expect(statuses[1].comment).toBe("Renuncia");
    expect(statuses[1].terminationRaw).toMatchObject({
      terminationTypeId: "Resignation (Voluntary)",
    });
  });

  it("is idempotent: a re-run changes nothing", async () => {
    await ingest("employee");
    await ingest("job_history");
    const before = await db
      .select()
      .from(employeeJobHistory)
      .orderBy(asc(employeeJobHistory.id));

    const { counts } = await ingest("job_history");

    expect(counts).toMatchObject({ read: 3, inserted: 0, unchanged: 3 });
    const after = await db
      .select()
      .from(employeeJobHistory)
      .orderBy(asc(employeeJobHistory.id));
    expect(after.map((r) => [r.id, r.validFrom, r.validTo])).toEqual(
      before.map((r) => [r.id, r.validFrom, r.validTo]),
    );
  });

  it("rebuilds the history when Bamboo rows change", async () => {
    await ingest("employee");
    await ingest("job_history");
    type Row = Record<string, unknown>;
    await editJson<Row[]>("tables-jobInfo.json", (rows) => {
      rows.push({
        id: "7",
        employeeId: "102",
        date: "2025-03-01",
        location: "Remoto",
        department: "Ingeniería",
        division: "Corporativo",
        jobTitle: "Staff Developer",
        reportsTo: "Ana García",
      });
    });

    const { counts } = await ingest("job_history");

    expect(counts).toMatchObject({ updated: 1, unchanged: 2 });
    const b = await historyOf(await personId("Bruno Pérez"));
    expect(b.map((r) => [r.validFrom, r.validTo])).toEqual([
      ["2021-07-15", "2023-01-01"],
      ["2023-01-01", "2025-03-01"],
      ["2025-03-01", null],
    ]);
  });

  it("keeps manager_raw and leaves the manager null when the name is ambiguous", async () => {
    type Page = { data: Record<string, unknown>[] };
    await editJson<Page>("employees-page-2.json", (page) => {
      page.data.push({
        id: 104,
        employeeNumber: "0004",
        displayName: "Carla Romero",
        workEmail: "carla.romero2@example.com",
        status: "Active",
        hireDate: "2022-02-01",
        supervisorEId: 101,
      });
    });
    await ingest("employee");
    const { counts, runId } = await ingest("job_history");

    expect(counts.managerUnresolved).toBe(1);
    const b = await historyOf(await personId("Bruno Pérez"));
    expect(b[0]).toMatchObject({
      managerPersonId: null,
      managerRaw: "Carla Romero",
    });
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.counts).toMatchObject({ managerUnresolved: 1 });
  });

  it("rejects rows of employees that were never ingested", async () => {
    const { counts } = await ingest("job_history");

    expect(counts).toMatchObject({ read: 3, rejected: 3, inserted: 0 });
    expect(await db.select().from(employeeJobHistory)).toHaveLength(0);
  });
});
