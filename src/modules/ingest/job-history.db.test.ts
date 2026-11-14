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
import { resolvePerson } from "./employee";
import { FixtureAdapter } from "./fixture-adapter";
import { runIngest } from "./run-ingest";
import { writeAsLastFirst } from "./test-helpers";

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
    // Both Carla Romero were employed when Bruno's first row started.
    type Page = { data: Record<string, unknown>[] };
    await editJson<Page>("employees-page-2.json", (page) => {
      page.data.push({
        id: 104,
        employeeNumber: "0004",
        displayName: "Carla Romero",
        workEmail: "carla.romero2@example.com",
        status: "Active",
        hireDate: "2019-02-01",
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

  it("resolves managers from Bamboo's 'Last, First' reportsTo to the 'First Last' people", async () => {
    await editJson<{ reportsTo: string | null }[]>(
      "tables-jobInfo.json",
      writeAsLastFirst,
    );
    await ingest("employee");
    const { counts } = await ingest("job_history");

    expect(counts).toMatchObject({ rejected: 0, managerUnresolved: 0 });
    const [ana, carla] = await Promise.all([
      personId("Ana García"),
      personId("Carla Romero"),
    ]);
    const b = await historyOf(await personId("Bruno Pérez"));
    // The first row has only the NAME: it resolves by matching it.
    expect(b.map((r) => [r.managerPersonId, r.managerRaw])).toEqual([
      [carla, "Romero, Carla"],
      [ana, "García, Ana"],
    ]);
    const c = await historyOf(carla);
    expect(c.map((r) => [r.managerPersonId, r.managerRaw])).toEqual([
      [ana, "García, Ana"],
    ]);
  });

  it("leaves namesakes unresolved and counted when reportsTo is 'Last, First'", async () => {
    type Page = { data: Record<string, unknown>[] };
    await editJson<Page>("employees-page-2.json", (page) => {
      page.data.push({
        id: 104,
        employeeNumber: "0004",
        displayName: "Carla Romero",
        workEmail: "carla.romero2@example.com",
        status: "Active",
        hireDate: "2019-02-01",
        supervisorEId: 101,
      });
    });
    await editJson<{ reportsTo: string | null }[]>(
      "tables-jobInfo.json",
      writeAsLastFirst,
    );
    await ingest("employee");
    const { counts } = await ingest("job_history");

    // Only Bruno's first row (Carla): Ana is unique, and the current rows
    // come from supervisorEId.
    expect(counts.managerUnresolved).toBe(1);
    const b = await historyOf(await personId("Bruno Pérez"));
    expect(b[0]).toMatchObject({
      managerPersonId: null,
      managerRaw: "Romero, Carla",
    });
    expect(b[1].managerPersonId).toBe(await personId("Ana García"));
  });

  it("picks the namesake who was employed on the row's date (a leaver and a later hire)", async () => {
    type Page = { data: Record<string, unknown>[] };
    // The first Carla Romero left on 2024-06-30; another one is hired later.
    await editJson<Page>("employees-page-2.json", (page) => {
      page.data.push({
        id: 104,
        employeeNumber: "0004",
        displayName: "Carla Romero",
        workEmail: "carla.romero2@example.com",
        status: "Active",
        hireDate: "2025-02-01",
        supervisorEId: 101,
      });
    });
    await editJson<Record<string, unknown>[]>("tables-jobInfo.json", (rows) => {
      const row = (id: string, date: string, reportsTo: string) => ({
        id,
        employeeId: "102",
        date,
        location: "Rosario",
        department: "Ingeniería",
        division: "Corporativo",
        jobTitle: "Senior Developer",
        reportsTo,
      });
      rows.push(
        row("7", "2025-03-01", "Carla Romero"),
        row("8", "2025-09-01", "Ana García"),
      );
      writeAsLastFirst(rows as { reportsTo: string | null }[]);
    });
    await ingest("employee");
    const { counts } = await ingest("job_history");

    expect(counts.managerUnresolved).toBe(0);
    const bambooId = (id: string) =>
      resolvePerson(db, "bamboo_api", { bambooId: id });
    const [oldCarla, newCarla, ana, bruno] = await Promise.all([
      bambooId("103"),
      bambooId("104"),
      bambooId("101"),
      bambooId("102"),
    ]);
    const b = await historyOf(bruno!);
    expect(b.map((r) => [r.validFrom, r.managerPersonId])).toEqual([
      ["2021-07-15", oldCarla],
      ["2023-01-01", ana],
      ["2025-03-01", newCarla],
      ["2025-09-01", ana],
    ]);
  });

  it("counts the managers matched only by the words of the name, in any order", async () => {
    await editJson<{ id: unknown; reportsTo: string | null }[]>(
      "tables-jobInfo.json",
      (rows) => {
        // Not how Bamboo writes it ("Last, First"): a fuzzy match.
        rows.find((r) => String(r.id) === "3")!.reportsTo = "Romero Carla";
      },
    );
    await ingest("employee");
    const { counts } = await ingest("job_history");

    expect(counts).toMatchObject({
      managerUnresolved: 0,
      managerResolvedFuzzy: 1,
    });
    const b = await historyOf(await personId("Bruno Pérez"));
    expect(b[0]).toMatchObject({
      managerPersonId: await personId("Carla Romero"),
      managerRaw: "Romero Carla",
    });
  });

  it("keeps resolving the current row by supervisorEId when its reportsTo name became ambiguous", async () => {
    type Page = { data: Record<string, unknown>[] };
    await editJson<Page>("employees-page-2.json", (page) => {
      page.data.push({
        id: 104,
        employeeNumber: "0004",
        displayName: "Ana García",
        workEmail: "ana.garcia2@example.com",
        status: "Active",
        hireDate: "2022-02-01",
        supervisorEId: 101,
      });
    });
    await editJson<{ reportsTo: string | null }[]>(
      "tables-jobInfo.json",
      writeAsLastFirst,
    );
    await ingest("employee");
    await ingest("job_history");

    // Two people are called Ana García now: the name cannot tell them apart,
    // but Bruno's current row has the supervisor's id.
    const supervisor = await resolvePerson(db, "bamboo_api", {
      bambooId: "101",
    });
    const b = await historyOf(await personId("Bruno Pérez"));
    expect(b.at(-1)).toMatchObject({
      managerPersonId: supervisor,
      managerRaw: "García, Ana",
    });
  });

  it("uses the supervisor of the latest employee ingest, even after a revert", async () => {
    type Page = { data: { id: unknown; supervisorEId: unknown }[] };
    const setSupervisor = (id: unknown) =>
      editJson<Page>("employees-page-1.json", (page) => {
        page.data.find((e) => String(e.id) === "102")!.supervisorEId = id;
      });
    await ingest("employee"); // 101
    await setSupervisor("103");
    await ingest("employee");
    await setSupervisor(101); // byte-identical to the first payload
    await ingest("employee");

    await ingest("job_history");

    const b = await historyOf(await personId("Bruno Pérez"));
    expect(b.at(-1)!.managerPersonId).toBe(await personId("Ana García"));
  });

  it("closes the open row at the employment's termination date even without a Terminated status", async () => {
    type Row = Record<string, unknown>;
    await editJson<Row[]>("tables-employmentStatus.json", (rows) => {
      rows.splice(
        rows.findIndex((r) => r.employmentStatus === "Terminated"),
        1,
      );
    });
    await ingest("employee");
    await ingest("job_history");

    const c = await historyOf(await personId("Carla Romero"));
    expect(c.map((r) => r.validTo)).toEqual(["2024-07-01"]);
  });

  it("rejects rows of employees that were never ingested", async () => {
    const { counts } = await ingest("job_history");

    expect(counts).toMatchObject({ read: 3, rejected: 3, inserted: 0 });
    expect(await db.select().from(employeeJobHistory)).toHaveLength(0);
  });
});
