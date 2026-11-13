import { rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
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
import { openIssueSourceIds } from "./raise";
import { ignoreIssue } from "./service";
import {
  addEmployee,
  carlaRehire,
  editPage,
  ingest,
  makeFixtureDir,
  removeDir,
  resetDb,
} from "./test-helpers";

let dir: string;

const issues = () => db.select().from(identityMatchIssue);
const personNamed = async (name: string) => {
  const [p] = await db
    .select()
    .from(person)
    .where(eq(person.displayName, name));
  return p;
};

describe("identity resolution during ingest", () => {
  beforeEach(async () => {
    await resetDb();
    dir = await makeFixtureDir();
  });
  afterEach(() => removeDir(dir));
  afterAll(async () => {
    await resetDb();
    await closeDb();
  });

  it("links a row with a known bamboo_id without going through the queue", async () => {
    await ingest(dir);
    await editPage(dir, "employees-page-1.json", (page) => {
      page.data[1].status = "Inactive";
    });

    const { counts } = await ingest(dir);

    expect(counts).toMatchObject({ updated: 1, unchanged: 2, issues: 0 });
    expect(await issues()).toEqual([]);
    expect(await db.select().from(person)).toHaveLength(3);
  });

  it("queues a known legajo under a new id with the person as candidate", async () => {
    const first = await ingest(dir);
    expect(first.counts).toMatchObject({ inserted: 3, issues: 0 });
    await addEmployee(dir, carlaRehire());

    const { counts, runId } = await ingest(dir);

    expect(counts).toMatchObject({
      read: 4,
      inserted: 0,
      unchanged: 3,
      issues: 1,
    });
    const carla = await personNamed("Carla Romero");
    const [issue] = await issues();
    expect(issue).toMatchObject({
      ingestRunId: runId,
      sourceSystem: "bamboo_api",
      entity: "employee",
      sourceId: "201",
      reason: "ambiguous",
      status: "open",
      resolution: null,
      resolvedAt: null,
      payload: expect.objectContaining({ id: 201, employeeNumber: "0003" }),
    });
    expect(issue.candidates).toEqual([
      {
        personId: carla.id,
        score: expect.closeTo(0.94, 2),
        matchedOn: ["employee_number", "work_email"],
      },
    ]);
    // Nothing was created or linked behind the reviewer's back.
    expect(await db.select().from(person)).toHaveLength(3);
    expect(
      await db.select().from(employment).where(eq(employment.sourceId, "201")),
    ).toEqual([]);
    const [raw] = await db
      .select()
      .from(rawRecord)
      .where(eq(rawRecord.sourceId, "201"));
    expect(issue.rawRecordId).toBe(raw.id);
  });

  it("proposes a person that only shares the email", async () => {
    await ingest(dir);
    await addEmployee(
      dir,
      carlaRehire({ employeeNumber: "9999", hireDate: "2025-03-01" }),
    );

    await ingest(dir);

    const [issue] = await issues();
    expect(issue.candidates.map((c) => c.matchedOn)).toEqual([["work_email"]]);
  });

  it("only proposes (never links) a person with the same normalized name and hire date", async () => {
    await ingest(dir);
    await addEmployee(dir, {
      id: 202,
      employeeNumber: "7777",
      displayName: "GARCÍA, ana",
      workEmail: "ana.g.new@example.com",
      status: "Active",
      hireDate: "2019-03-01",
    });

    const { counts } = await ingest(dir);

    expect(counts).toMatchObject({ inserted: 0, issues: 1 });
    const ana = await personNamed("Ana García");
    const [issue] = await issues();
    expect(issue.reason).toBe("ambiguous");
    expect(issue.candidates).toEqual([
      {
        personId: ana.id,
        score: expect.any(Number),
        matchedOn: ["name_hire_date"],
      },
    ]);
    expect(await db.select().from(person)).toHaveLength(3);
  });

  it("does not propose a person only by an employment that was soft-deleted", async () => {
    await ingest(dir);
    // Ana is gone from the full extraction: her employment is soft-deleted.
    await editPage(dir, "employees-page-1.json", (page) => {
      page.data.splice(0, 1);
    });
    await rm(path.join(dir, "employee-101.json"));
    expect((await ingest(dir)).counts).toMatchObject({ deleted: 1 });
    await addEmployee(dir, {
      id: 202,
      employeeNumber: "7777",
      displayName: "Ana García",
      workEmail: "ana.g.new@example.com",
      status: "Active",
      hireDate: "2019-03-01",
    });

    const { counts } = await ingest(dir);

    expect(counts).toMatchObject({ inserted: 1, issues: 0 });
    expect(await issues()).toEqual([]);
  });

  it("ranks candidates matched by stronger keys higher", async () => {
    await ingest(dir);
    // Legajo of Ana, email of Bruno, name and hire date of Ana.
    await addEmployee(dir, {
      id: 203,
      employeeNumber: "0001",
      displayName: "Ana García",
      workEmail: "bruno.perez@example.com",
      status: "Active",
      hireDate: "2019-03-01",
    });

    await ingest(dir);

    const [issue] = await issues();
    const [first, second] = issue.candidates;
    expect(first.matchedOn).toEqual(["employee_number", "name_hire_date"]);
    expect(second.matchedOn).toEqual(["work_email"]);
    expect(first.score).toBeGreaterThan(second.score);
  });

  it("does not propose by name alone: without a hire date match it is a new person", async () => {
    await ingest(dir);
    await addEmployee(dir, {
      id: 204,
      employeeNumber: "8888",
      displayName: "Ana García",
      workEmail: "ana.garcia.2@example.com",
      status: "Active",
      hireDate: "2024-01-15",
    });

    const { counts } = await ingest(dir);

    expect(counts).toMatchObject({ inserted: 1, issues: 0 });
    expect(await issues()).toEqual([]);
  });

  it("creates a person automatically when nothing matches and nothing resembles it", async () => {
    await ingest(dir);
    await addEmployee(dir, {
      id: 205,
      employeeNumber: "5555",
      displayName: "Elena Sosa",
      workEmail: "elena.sosa@example.com",
      status: "Active",
      hireDate: "2026-02-01",
    });

    const { counts } = await ingest(dir);

    expect(counts).toMatchObject({ read: 4, inserted: 1, issues: 0 });
    const elena = await personNamed("Elena Sosa");
    const ids = await db
      .select({ kind: sourceIdentity.kind, value: sourceIdentity.value })
      .from(sourceIdentity)
      .where(eq(sourceIdentity.personId, elena.id));
    expect(ids).toEqual(
      expect.arrayContaining([
        { kind: "bamboo_id", value: "205" },
        { kind: "employee_number", value: "5555" },
        { kind: "work_email", value: "elena.sosa@example.com" },
      ]),
    );
  });

  it("queues an unmatched row without candidates when running strict", async () => {
    await addEmployee(dir, {
      id: 205,
      displayName: "Elena Sosa",
      status: "Active",
      hireDate: "2026-02-01",
    });

    const { counts } = await ingest(dir, { unmatched: "queue" });

    expect(counts).toMatchObject({ read: 4, inserted: 0, issues: 4 });
    expect(await db.select().from(person)).toHaveLength(0);
    const elena = (await issues()).find((i) => i.sourceId === "205");
    expect(elena).toMatchObject({ reason: "no_match", candidates: [] });
  });

  it("a conflicting identifier is queued and the rest of the row is still applied", async () => {
    await ingest(dir);
    await editPage(dir, "employees-page-1.json", (page) => {
      page.data[1].workEmail = "ana.garcia@example.com";
      page.data[1].status = "Inactive";
    });

    const { counts, runId } = await ingest(dir);

    expect(counts).toMatchObject({ read: 3, unchanged: 2, issues: 1 });
    const ana = await personNamed("Ana García");
    const bruno = await personNamed("Bruno Pérez");
    const [issue] = await issues();
    expect(issue).toMatchObject({
      ingestRunId: runId,
      sourceId: "102",
      reason: "conflict",
      status: "open",
    });
    expect(issue.candidates).toEqual([
      { personId: bruno.id, score: 1, matchedOn: ["bamboo_id"] },
      {
        personId: ana.id,
        score: expect.any(Number),
        matchedOn: ["work_email"],
      },
    ]);
    // The holder keeps the email, Bruno keeps his old one, the status change
    // that came with the same row is not lost.
    const open = (personId: string) =>
      db
        .select({ kind: sourceIdentity.kind, value: sourceIdentity.value })
        .from(sourceIdentity)
        .where(
          and(
            eq(sourceIdentity.personId, personId),
            isNull(sourceIdentity.validTo),
          ),
        );
    expect(await open(ana.id)).toContainEqual({
      kind: "work_email",
      value: "ana.garcia@example.com",
    });
    expect(await open(bruno.id)).toContainEqual({
      kind: "work_email",
      value: "bruno.perez@example.com",
    });
    const [brunoEmployment] = await db
      .select()
      .from(employment)
      .where(eq(employment.sourceId, "102"));
    expect(brunoEmployment.status).toBe("Inactive");
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run.rejects).toEqual([]);
  });

  it("knows which source records have an open issue", async () => {
    await ingest(dir);
    expect(await openIssueSourceIds(db, "bamboo_api", "employee")).toEqual(
      new Set(),
    );
    await addEmployee(dir, carlaRehire());
    await ingest(dir);
    const [issue] = await issues();

    expect(await openIssueSourceIds(db, "bamboo_api", "employee")).toEqual(
      new Set(["201"]),
    );
    await ignoreIssue(db, issue.id);
    expect(await openIssueSourceIds(db, "bamboo_api", "employee")).toEqual(
      new Set(),
    );
  });

  describe("a conflict whose row does not change", () => {
    const conflictWithAna = (page: { data: Record<string, unknown>[] }) => {
      page.data[1].workEmail = "ana.garcia@example.com";
    };

    it("stays queued and counted while the other person still holds the value", async () => {
      await ingest(dir);
      await editPage(dir, "employees-page-1.json", conflictWithAna);
      await ingest(dir);

      const { counts, runId } = await ingest(dir);

      expect(counts).toMatchObject({ unchanged: 2, issues: 1 });
      const [issue] = await issues();
      expect(issue).toMatchObject({
        status: "open",
        reason: "conflict",
        ingestRunId: runId,
      });
    });

    it("is resolved when the holder frees the value, though Bamboo resends the same row", async () => {
      await ingest(dir);
      await editPage(dir, "employees-page-1.json", conflictWithAna);
      await ingest(dir);
      // Ana moves to a new address; Bruno's row is byte for byte the same.
      await editPage(dir, "employees-page-1.json", (page) => {
        page.data[0].workEmail = "ana.nueva@example.com";
      });

      const { counts } = await ingest(dir);

      expect(counts).toMatchObject({ updated: 2, unchanged: 1, issues: 0 });
      const bruno = await personNamed("Bruno Pérez");
      const open = await db
        .select({ kind: sourceIdentity.kind, value: sourceIdentity.value })
        .from(sourceIdentity)
        .where(
          and(
            eq(sourceIdentity.personId, bruno.id),
            isNull(sourceIdentity.validTo),
          ),
        );
      expect(open).toContainEqual({
        kind: "work_email",
        value: "ana.garcia@example.com",
      });
      const [issue] = await issues();
      expect(issue).toMatchObject({
        status: "resolved",
        resolution: { action: "link", personId: bruno.id, auto: true },
      });
      expect(issue.resolvedAt).toBeInstanceOf(Date);
    });
  });

  it("never drops a row: read = inserted + updated + unchanged + rejected + issues + ignored", async () => {
    await ingest(dir);
    // A reviewer already decided to ignore this exact record.
    await addEmployee(dir, carlaRehire({ id: 208, employeeNumber: "0001" }));
    await ingest(dir);
    const [carla208] = await issues();
    await ignoreIssue(db, carla208.id);
    await editPage(dir, "employees-page-1.json", (page) => {
      page.data[0].status = "Inactive"; // updated
      page.data[1].workEmail = "carla.romero@example.com"; // conflict
    });
    await addEmployee(dir, carlaRehire()); // ambiguous
    await addEmployee(dir, { id: 206, displayName: null, firstName: null }); // rejected
    await addEmployee(dir, {
      id: 207,
      displayName: "Nuevo Ingreso",
      status: "Active",
    }); // inserted

    const { counts } = await ingest(dir);

    expect(counts).toMatchObject({
      read: 7,
      inserted: 1,
      updated: 1,
      unchanged: 1,
      rejected: 1,
      issues: 2,
      ignored: 1,
    });
    expect(
      counts.inserted +
        counts.updated +
        counts.unchanged +
        counts.rejected +
        (counts.issues ?? 0) +
        (counts.ignored ?? 0),
    ).toBe(counts.read);
  });

  it("re-running the same extraction keeps a single open issue per row", async () => {
    await ingest(dir);
    await addEmployee(dir, carlaRehire());
    await ingest(dir);

    const second = await ingest(dir);

    expect(second.counts).toMatchObject({ unchanged: 3, issues: 1 });
    const all = await issues();
    expect(all).toHaveLength(1);
    expect(all[0].ingestRunId).toBe(second.runId);
  });

  it("closes an open issue when the row later applies cleanly", async () => {
    await ingest(dir);
    await addEmployee(dir, carlaRehire());
    await ingest(dir);
    // Bamboo fixes the legajo and the email: nothing points at Carla anymore.
    await editPage(dir, "employees-page-2.json", (page) => {
      Object.assign(page.data[1], {
        employeeNumber: "4040",
        workEmail: "carla.nueva@example.com",
        displayName: "Carla Nueva",
      });
    });

    const { counts } = await ingest(dir);

    expect(counts).toMatchObject({ inserted: 1, issues: 0 });
    const [issue] = await issues();
    expect(issue.status).toBe("resolved");
    expect(issue.resolvedAt).toBeInstanceOf(Date);
    expect(issue.resolution).toMatchObject({ action: "link" });
  });
});
