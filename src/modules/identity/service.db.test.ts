import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  employment,
  identityMatchIssue,
  person,
  sourceIdentity,
} from "@/db/schema";
import { getPerson } from "@/modules/people/queries";
import {
  countOpenIssues,
  getIssue,
  ignoreIssue,
  listIssues,
  resolveIssue,
} from "./service";
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

const personNamed = async (name: string) => {
  const [p] = await db
    .select()
    .from(person)
    .where(eq(person.displayName, name));
  return p;
};
const openIdentities = (personId: string) =>
  db
    .select({ kind: sourceIdentity.kind, value: sourceIdentity.value })
    .from(sourceIdentity)
    .where(
      and(
        eq(sourceIdentity.personId, personId),
        isNull(sourceIdentity.validTo),
      ),
    );
const employmentsOf = (sourceId: string) =>
  db.select().from(employment).where(eq(employment.sourceId, sourceId));

/** The fixtures plus Carla coming back as id 201: one open ambiguous issue. */
async function queueCarlasRehire(overrides: Record<string, unknown> = {}) {
  await ingest(dir);
  await addEmployee(dir, carlaRehire(overrides));
  const { runId } = await ingest(dir);
  const [issue] = await db.select().from(identityMatchIssue);
  return { issue, runId };
}

describe("identity queue", () => {
  beforeEach(async () => {
    await resetDb();
    dir = await makeFixtureDir();
  });
  afterEach(() => removeDir(dir));
  afterAll(async () => {
    await resetDb();
    await closeDb();
  });

  describe("listIssues / getIssue", () => {
    it("lists open issues first with a summary of the payload", async () => {
      const { issue } = await queueCarlasRehire();
      await ingest(dir);
      await db.insert(identityMatchIssue).values({
        ingestRunId: issue.ingestRunId,
        sourceSystem: "bamboo_api",
        entity: "employee",
        sourceId: "999",
        payload: { id: 999, displayName: "Old Case" },
        reason: "no_match",
        status: "resolved",
        resolution: { action: "create" },
        resolvedAt: new Date(),
      });

      const open = await listIssues(db, { status: "open" });
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        id: issue.id,
        reason: "ambiguous",
        status: "open",
        sourceId: "201",
        candidateCount: 1,
        summary: {
          displayName: "Carla Romero",
          employeeNumber: "0003",
          workEmail: "carla.romero@example.com",
          hireDate: "2025-03-01",
        },
      });
      expect(await countOpenIssues(db)).toBe(1);

      const all = await listIssues(db, {
        status: ["open", "resolved", "ignored"],
      });
      expect(all.map((i) => i.status)).toEqual(["open", "resolved"]);
      expect(
        (await listIssues(db, { status: "resolved" })).map((i) => i.sourceId),
      ).toEqual(["999"]);
    });

    it("returns the candidates of an issue with who they are", async () => {
      const { issue } = await queueCarlasRehire();
      const carla = await personNamed("Carla Romero");

      const detail = await getIssue(db, issue.id);

      expect(detail).toMatchObject({
        id: issue.id,
        payload: expect.objectContaining({ id: 201 }),
        candidates: [
          {
            personId: carla.id,
            matchedOn: ["employee_number", "work_email"],
            displayName: "Carla Romero",
            workEmail: "carla.romero@example.com",
            employments: [
              {
                hireDate: null,
                terminationDate: "2024-06-30",
                status: "Inactive",
              },
            ],
          },
        ],
      });
    });

    it("returns null for an unknown or malformed id", async () => {
      expect(
        await getIssue(db, "00000000-0000-4000-8000-000000000000"),
      ).toBeNull();
      expect(await getIssue(db, "not-a-uuid")).toBeNull();
    });
  });

  describe("resolveIssue: link", () => {
    it("adds an employment to the existing person and the new Bamboo id", async () => {
      const { issue } = await queueCarlasRehire();
      const carla = await personNamed("Carla Romero");

      await resolveIssue(db, issue.id, {
        action: "link",
        personId: carla.id,
        actorNote: "Es Carla, volvió",
      });

      const periods = await employmentsOf("201");
      expect(periods).toHaveLength(1);
      expect(periods[0]).toMatchObject({
        personId: carla.id,
        hireDate: "2025-03-01",
        status: "Active",
        ingestRunId: issue.ingestRunId,
        deletedAt: null,
      });
      expect(await db.select().from(person)).toHaveLength(3);
      // Both Bamboo ids stay open on the same person.
      expect(await openIdentities(carla.id)).toEqual(
        expect.arrayContaining([
          { kind: "bamboo_id", value: "103" },
          { kind: "bamboo_id", value: "201" },
          { kind: "employee_number", value: "0003" },
          { kind: "work_email", value: "carla.romero@example.com" },
        ]),
      );
      const detail = await getPerson(db, carla.id);
      expect(detail?.employments).toHaveLength(2);

      const [resolved] = await db.select().from(identityMatchIssue);
      expect(resolved).toMatchObject({
        status: "resolved",
        resolution: {
          action: "link",
          personId: carla.id,
          actorNote: "Es Carla, volvió",
        },
      });
      expect(resolved.resolvedAt).toBeInstanceOf(Date);
    });

    it("the next ingest finds the row linked and changes nothing", async () => {
      const { issue } = await queueCarlasRehire();
      const carla = await personNamed("Carla Romero");
      await resolveIssue(db, issue.id, { action: "link", personId: carla.id });

      const { counts } = await ingest(dir);

      expect(counts).toMatchObject({
        read: 4,
        unchanged: 4,
        inserted: 0,
        updated: 0,
        issues: 0,
      });
      expect(await db.select().from(identityMatchIssue)).toHaveLength(1);
    });

    it("a past stint changing later does not overwrite the current email", async () => {
      const { issue } = await queueCarlasRehire({
        workEmail: "carla.nueva@example.com",
      });
      const carla = await personNamed("Carla Romero");
      await resolveIssue(db, issue.id, { action: "link", personId: carla.id });
      expect(await openIdentities(carla.id)).toContainEqual({
        kind: "work_email",
        value: "carla.nueva@example.com",
      });

      await editPage(dir, "employees-page-2.json", (page) => {
        page.data[0].terminationDate = "2024-07-31";
      });
      await ingest(dir);

      const [reloaded] = await db
        .select()
        .from(person)
        .where(eq(person.id, carla.id));
      expect(reloaded.workEmail).toBe("carla.nueva@example.com");
      expect(
        (await openIdentities(carla.id)).filter((i) => i.kind === "work_email"),
      ).toEqual([{ kind: "work_email", value: "carla.nueva@example.com" }]);
      const [old] = await employmentsOf("103");
      expect(old.terminationDate).toBe("2024-07-31");
    });

    it("is idempotent: resolving twice the same way changes nothing more", async () => {
      const { issue } = await queueCarlasRehire();
      const carla = await personNamed("Carla Romero");
      const input = { action: "link", personId: carla.id } as const;

      const first = await resolveIssue(db, issue.id, input);
      const second = await resolveIssue(db, issue.id, input);

      expect(second).toEqual(first);
      expect(await employmentsOf("201")).toHaveLength(1);
      await expect(
        resolveIssue(db, issue.id, { action: "create" }),
      ).rejects.toMatchObject({ code: "already_resolved" });
      await expect(ignoreIssue(db, issue.id)).rejects.toMatchObject({
        code: "already_resolved",
      });
    });

    it("needs an existing person", async () => {
      const { issue } = await queueCarlasRehire();

      await expect(
        resolveIssue(db, issue.id, { action: "link" }),
      ).rejects.toMatchObject({ code: "person_required" });
      await expect(
        resolveIssue(db, issue.id, {
          action: "link",
          personId: "00000000-0000-4000-8000-000000000000",
        }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        resolveIssue(db, issue.id, { action: "link", personId: "nope" }),
      ).rejects.toMatchObject({ code: "not_found" });
      const [still] = await db.select().from(identityMatchIssue);
      expect(still.status).toBe("open");
    });

    it("refuses to link a row that is already applied to someone else", async () => {
      const { issue } = await queueCarlasRehire();
      const carla = await personNamed("Carla Romero");
      const ana = await personNamed("Ana García");
      await db.insert(employment).values({
        personId: ana.id,
        sourceSystem: "bamboo_api",
        sourceId: "201",
        hireDate: "2025-03-01",
      });

      await expect(
        resolveIssue(db, issue.id, { action: "link", personId: carla.id }),
      ).rejects.toMatchObject({ code: "already_applied" });
      await expect(
        resolveIssue(db, issue.id, { action: "create" }),
      ).rejects.toMatchObject({ code: "already_applied" });
    });

    it("rolls the whole resolution back when the row cannot be applied", async () => {
      const { issue } = await queueCarlasRehire();
      const carla = await personNamed("Carla Romero");
      await db
        .update(identityMatchIssue)
        .set({ payload: { id: 201, displayName: null } })
        .where(eq(identityMatchIssue.id, issue.id));

      await expect(
        resolveIssue(db, issue.id, { action: "link", personId: carla.id }),
      ).rejects.toMatchObject({ code: "invalid_payload" });

      const [still] = await db.select().from(identityMatchIssue);
      expect(still.status).toBe("open");
    });
  });

  describe("resolveIssue: create", () => {
    it("creates a new person for a look-alike and records who", async () => {
      await ingest(dir);
      await addEmployee(dir, {
        id: 202,
        employeeNumber: "7777",
        displayName: "Ana García",
        workEmail: "ana.g.new@example.com",
        status: "Active",
        hireDate: "2019-03-01",
      });
      await ingest(dir);
      const [issue] = await db.select().from(identityMatchIssue);

      await resolveIssue(db, issue.id, { action: "create" });

      expect(await db.select().from(person)).toHaveLength(4);
      const [created] = await employmentsOf("202");
      const [resolved] = await db.select().from(identityMatchIssue);
      expect(resolved).toMatchObject({
        status: "resolved",
        resolution: { action: "create", personId: created.personId },
      });
      expect(await openIdentities(created.personId)).toEqual(
        expect.arrayContaining([
          { kind: "bamboo_id", value: "202" },
          { kind: "employee_number", value: "7777" },
          { kind: "work_email", value: "ana.g.new@example.com" },
        ]),
      );
    });

    it("resolves a strict no_match issue by creating the person", async () => {
      await addEmployee(dir, {
        id: 205,
        displayName: "Elena Sosa",
        status: "Active",
      });
      await ingest(dir, { unmatched: "queue" });
      const issue = (await db.select().from(identityMatchIssue)).find(
        (i) => i.sourceId === "205",
      )!;

      await resolveIssue(db, issue.id, { action: "create" });

      expect((await personNamed("Elena Sosa"))?.id).toBeDefined();
      expect(await employmentsOf("205")).toHaveLength(1);
    });

    it("flags a conflict when the new person shares a key with the candidate", async () => {
      const { issue } = await queueCarlasRehire();
      const carla = await personNamed("Carla Romero");

      await resolveIssue(db, issue.id, { action: "create" });

      const rows = await db.select().from(identityMatchIssue);
      expect(rows.map((r) => [r.reason, r.status]).sort()).toEqual([
        ["ambiguous", "resolved"],
        ["conflict", "open"],
      ]);
      const conflict = rows.find((r) => r.reason === "conflict")!;
      expect(conflict.candidates.map((c) => c.personId)).toContain(carla.id);
      // Carla keeps her identifiers.
      expect(await openIdentities(carla.id)).toContainEqual({
        kind: "employee_number",
        value: "0003",
      });
    });
  });

  describe("ignoreIssue", () => {
    it("closes the issue without touching people", async () => {
      const { issue } = await queueCarlasRehire();

      const done = await ignoreIssue(db, issue.id, "Contratista");

      expect(done).toMatchObject({
        status: "ignored",
        resolution: { action: "ignore", actorNote: "Contratista" },
      });
      expect(done.resolvedAt).toBeInstanceOf(Date);
      expect(await db.select().from(person)).toHaveLength(3);
      expect(await employmentsOf("201")).toEqual([]);
      expect(await countOpenIssues(db)).toBe(0);
    });

    it("is idempotent", async () => {
      const { issue } = await queueCarlasRehire();
      const first = await ignoreIssue(db, issue.id);
      expect(await ignoreIssue(db, issue.id)).toEqual(first);
    });

    it("stays ignored while Bamboo sends the same record, and comes back when it changes", async () => {
      const { issue } = await queueCarlasRehire();
      await ignoreIssue(db, issue.id);

      const same = await ingest(dir);
      expect(same.counts).toMatchObject({ read: 4, unchanged: 4, issues: 0 });
      expect(await countOpenIssues(db)).toBe(0);

      await editPage(dir, "employees-page-2.json", (page) => {
        page.data[1].hireDate = "2025-04-01";
      });
      const changed = await ingest(dir);
      expect(changed.counts).toMatchObject({ issues: 1, unchanged: 3 });
      expect(await countOpenIssues(db)).toBe(1);
      expect(await db.select().from(identityMatchIssue)).toHaveLength(2);
    });

    it("is the only way to settle a conflict", async () => {
      await ingest(dir);
      await editPage(dir, "employees-page-1.json", (page) => {
        page.data[1].workEmail = "ana.garcia@example.com";
      });
      await ingest(dir);
      const [issue] = await db.select().from(identityMatchIssue);
      expect(issue.reason).toBe("conflict");
      const ana = await personNamed("Ana García");

      await expect(
        resolveIssue(db, issue.id, { action: "link", personId: ana.id }),
      ).rejects.toMatchObject({ code: "invalid_action" });
      await expect(
        resolveIssue(db, issue.id, { action: "create" }),
      ).rejects.toMatchObject({ code: "invalid_action" });

      await ignoreIssue(db, issue.id);
      expect((await listIssues(db, { status: "ignored" }))[0].reason).toBe(
        "conflict",
      );
    });
  });

  it("reports unknown issues", async () => {
    await expect(
      resolveIssue(db, "00000000-0000-4000-8000-000000000000", {
        action: "ignore",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      resolveIssue(db, "nope", { action: "ignore" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
