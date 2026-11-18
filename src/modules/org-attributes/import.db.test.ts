import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { identityMatchIssue, ingestRun, personOrgAttribute } from "@/db/schema";
import { resolveIssue } from "@/modules/identity";
import { writeCsv } from "@/modules/import-history/test-support";
import { xlsxFromRows } from "@/modules/lake/test-xlsx";
import { getBuiltinProfile } from "@/modules/lake/profiles";
import {
  importReportFile,
  importUpload,
  saveProfile,
  storeUpload,
} from "@/modules/lake/upload";
import { insertOrgAttribute } from "./test-support";
import { insertPerson } from "@/modules/analytics/test-support";
import { resetAll } from "@/modules/analytics/test-support";

const HEADER = "EEID,Nombre,Cuenta,Proyecto,DM,Santex Lead,Desde,Hasta";
const importWith = (header: string, lines: string[]) =>
  writeCsv([header, ...lines]).then((path) =>
    importReportFile(db, { path, profile: "org-attributes" }),
  );
const importFile = (lines: string[]) => importWith(HEADER, lines);

let ana: string;
let bruno: string;
let marta: string;
let nora: string;

beforeEach(async () => {
  await resetAll();
  ana = await insertPerson({ displayName: "Ana Prieto", bambooId: "11" });
  bruno = await insertPerson({ displayName: "Bruno Soler", bambooId: "12" });
  marta = await insertPerson({ displayName: "Marta Quiroga", bambooId: "21" });
  nora = await insertPerson({ displayName: "Nora Salas", bambooId: "22" });
});
afterAll(async () => {
  await resetAll();
  await closeDb();
});

/** Every row of a person, the dropped ones too. */
const allAttrs = (personId: string) =>
  db
    .select()
    .from(personOrgAttribute)
    .where(eq(personOrgAttribute.personId, personId))
    .orderBy(asc(personOrgAttribute.validFrom), asc(personOrgAttribute.kind));

const attrs = (personId: string) =>
  db
    .select()
    .from(personOrgAttribute)
    .where(
      and(
        eq(personOrgAttribute.personId, personId),
        isNull(personOrgAttribute.deletedAt),
      ),
    )
    .orderBy(asc(personOrgAttribute.validFrom), asc(personOrgAttribute.kind));

describe("importing the org attributes file", () => {
  it("writes one attribute per cell, valid from Desde to Hasta, and resolves DMs to people", async () => {
    const result = await importFile([
      "11,Ana Prieto,Cuenta A,Proyecto A1,Marta Quiroga,Nora Salas,2024-01-01,2024-12-31",
      '11,Ana Prieto,Cuenta B,,"Salas, Nora",21,01/01/2025,',
    ]);

    expect(result.status ?? "succeeded").toBe("succeeded");
    expect(result.counts).toMatchObject({ read: 2, inserted: 2, rejected: 0 });
    const rows = await attrs(ana);
    expect(rows.map((r) => [r.kind, r.value, r.validFrom, r.validTo])).toEqual([
      ["account", "Cuenta A", "2024-01-01", "2024-12-31"],
      ["project", "Proyecto A1", "2024-01-01", "2024-12-31"],
      ["dm", "Marta Quiroga", "2024-01-01", "2024-12-31"],
      ["santex_lead", "Nora Salas", "2024-01-01", "2024-12-31"],
      // dd/mm/yyyy, an empty Proyecto writes nothing, "Apellido, Nombre"
      // and an EEID both name a person.
      ["account", "Cuenta B", "2025-01-01", null],
      ["dm", "Salas, Nora", "2025-01-01", null],
      ["santex_lead", "21", "2025-01-01", null],
    ]);
    const ref = (kind: string, from: string) =>
      rows.find((r) => r.kind === kind && r.validFrom === from)?.refPersonId;
    expect(ref("dm", "2024-01-01")).toBe(marta);
    expect(ref("santex_lead", "2024-01-01")).toBe(nora);
    expect(ref("dm", "2025-01-01")).toBe(nora);
    expect(ref("santex_lead", "2025-01-01")).toBe(marta);
    expect(ref("account", "2024-01-01")).toBeNull();
    expect(rows.every((r) => r.sourceSystem === "lake")).toBe(true);
  });

  it("leaves a DM nobody matches unresolved: it still groups and filters", async () => {
    await importFile(["12,Bruno Soler,Cuenta A,,Alguien Externo,,,"]);

    const rows = await attrs(bruno);
    expect(rows.map((r) => [r.kind, r.value, r.refPersonId])).toEqual([
      ["account", "Cuenta A", null],
      ["dm", "Alguien Externo", null],
    ]);
    // No Desde: since ever.
    expect(rows[0].validFrom).toBe("1900-01-01");
  });

  it("is idempotent: the same file again changes nothing", async () => {
    const lines = [
      "11,Ana Prieto,Cuenta A,Proyecto A1,Marta Quiroga,Nora Salas,2024-01-01,2024-12-31",
      "12,Bruno Soler,Cuenta A,,Marta Quiroga,,,",
    ];
    await importFile(lines);

    const again = await importFile(lines);

    expect(again.counts).toMatchObject({
      read: 2,
      inserted: 0,
      updated: 0,
      unchanged: 2,
    });
    expect(await attrs(ana)).toHaveLength(4);
  });

  it("updates a corrected row and soft-deletes a cell emptied since", async () => {
    await importFile([
      "11,Ana Prieto,Cuenta A,Proyecto A1,Marta Quiroga,Nora Salas,2024-01-01,",
    ]);

    const fixed = await importFile([
      "11,Ana Prieto,Cuenta A2,,Marta Quiroga,Nora Salas,2024-01-01,2024-06-30",
    ]);

    expect(fixed.counts).toMatchObject({ inserted: 0, updated: 1 });
    expect((await attrs(ana)).map((r) => [r.kind, r.value, r.validTo])).toEqual(
      [
        ["account", "Cuenta A2", "2024-06-30"],
        ["dm", "Marta Quiroga", "2024-06-30"],
        ["santex_lead", "Nora Salas", "2024-06-30"],
      ],
    );
    const all = await db
      .select()
      .from(personOrgAttribute)
      .where(eq(personOrgAttribute.personId, ana));
    expect(all.filter((r) => r.deletedAt !== null).map((r) => r.kind)).toEqual([
      "project",
    ]);

    // Coming back un-deletes it.
    await importFile([
      "11,Ana Prieto,Cuenta A2,Proyecto A1,Marta Quiroga,Nora Salas,2024-01-01,2024-06-30",
    ]);
    expect((await attrs(ana)).map((r) => r.kind)).toContain("project");
  });

  it("sends an EEID nobody has to the identity queue, once, and links it on resolve", async () => {
    const line = "99,Zoe Nadie,Cuenta C,Proyecto C1,Marta Quiroga,,2024-01-01,";
    const first = await importFile([line]);
    const second = await importFile([line]);

    expect(first.counts).toMatchObject({ read: 1, inserted: 0, issues: 1 });
    expect(second.counts).toMatchObject({ issues: 1 });
    const issues = await db
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.entity, "org_attribute"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      status: "open",
      reason: "no_match",
      sourceId: JSON.stringify(["99", "2024-01-01"]),
    });

    const zoe = await insertPerson({ displayName: "Zoe Nadie" });
    await resolveIssue(db, issues[0].id, { action: "link", personId: zoe });

    expect((await attrs(zoe)).map((r) => [r.kind, r.value])).toEqual([
      ["account", "Cuenta C"],
      ["project", "Proyecto C1"],
      ["dm", "Marta Quiroga"],
    ]);
    // The next import of the row knows who it is.
    const again = await importFile([line]);
    expect(again.counts).toMatchObject({ issues: 0, unchanged: 1 });
  });

  it("matches the EEID once the person arrives, and closes the issue", async () => {
    const line = "77,Nuevo Ingreso,Cuenta C,,,,2024-01-01,";
    await importFile([line]);
    const nuevo = await insertPerson({
      displayName: "Nuevo Ingreso",
      bambooId: "77",
    });

    const again = await importFile([line]);

    expect(again.counts).toMatchObject({ inserted: 1, issues: 0 });
    expect(await attrs(nuevo)).toHaveLength(1);
    const [issue] = await db
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.entity, "org_attribute"));
    expect(issue.status).toBe("resolved");
  });

  it("rejects rows that cannot be read, with the reason, and imports the rest", async () => {
    const result = await importFile([
      "11,Ana Prieto,Cuenta A,,,,mañana,",
      "11,Ana Prieto,,,,,2024-01-01,",
      ",Sin Id,Cuenta A,,,,2024-01-01,",
      "12,Bruno Soler,Cuenta A,,,,2024-01-01,",
    ]);

    expect(result.counts).toMatchObject({ read: 4, rejected: 3, inserted: 1 });
    const [run] = await db
      .select({ rejects: ingestRun.rejects })
      .from(ingestRun)
      .where(eq(ingestRun.id, result.runId));
    const reasons = (run.rejects ?? []).map((r) => r.reason).join("\n");
    expect(reasons).toMatch(/Desde "mañana" is not a date/);
    expect(reasons).toMatch(/no Cuenta, Proyecto, DM or Santex Lead/);
    expect(reasons).toMatch(/EEID/);
  });
});

describe("importing the org attributes file as a workbook", () => {
  it("reads an .xlsx the same, dates as Excel dates, and tells the upload it mapped attributes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "org-xlsx-"));
    try {
      const store = {
        uploadsDir: path.join(root, "uploads"),
        profilesDir: path.join(root, "profiles"),
      };
      const stored = await storeUpload(
        {
          name: "atributos.xlsx",
          bytes: Buffer.from(
            xlsxFromRows([
              HEADER.split(","),
              [
                "11",
                "Ana Prieto",
                "Cuenta A",
                "Proyecto A1",
                "Marta Quiroga",
                "Nora Salas",
                "2024-01-01",
                "2024-12-31",
              ],
              ["12", "Bruno Soler", "Cuenta B", "", "", "", "", ""],
            ]),
          ),
        },
        store,
      );

      const result = await importUpload({
        uploadId: stored.id,
        fileName: "atributos.xlsx",
        profile: { builtin: "org-attributes" },
        db,
        store,
      });

      expect(result.mode).toBe("attributes");
      expect(result.counts).toMatchObject({
        read: 2,
        inserted: 2,
        rejected: 0,
      });
      expect(
        (await attrs(ana)).map((r) => [
          r.kind,
          r.value,
          r.validFrom,
          r.validTo,
        ]),
      ).toEqual([
        ["account", "Cuenta A", "2024-01-01", "2024-12-31"],
        ["project", "Proyecto A1", "2024-01-01", "2024-12-31"],
        ["dm", "Marta Quiroga", "2024-01-01", "2024-12-31"],
        ["santex_lead", "Nora Salas", "2024-01-01", "2024-12-31"],
      ]);
      expect((await attrs(bruno)).map((r) => [r.kind, r.value])).toEqual([
        ["account", "Cuenta B"],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a file with only some of the columns", () => {
  const FULL =
    "11,Ana Prieto,Cuenta A,Proyecto A1,Marta Quiroga,Nora Salas,2024-01-01,";

  it("only touches the kinds it has a column for: the rest stays as it was", async () => {
    await importFile([FULL]);

    const result = await importWith("EEID,DM,Desde", [
      "11,Nora Salas,2024-01-01",
    ]);

    expect(result.counts).toMatchObject({ updated: 1, deleted: 0 });
    expect(
      (await attrs(ana)).map((r) => [r.kind, r.value, r.refPersonId]),
    ).toEqual([
      ["account", "Cuenta A", null],
      ["project", "Proyecto A1", null],
      ["dm", "Nora Salas", nora],
      ["santex_lead", "Nora Salas", nora],
    ]);
  });

  it("an empty cell in a column it has drops only that attribute", async () => {
    await importFile([FULL]);

    await importWith("EEID,Proyecto,DM,Desde", [
      "11,,Marta Quiroga,2024-01-01",
    ]);

    expect((await attrs(ana)).map((r) => r.kind)).toEqual([
      "account",
      "dm",
      "santex_lead",
    ]);
  });

  it("is the list of only the kinds it has a column for: the other kinds of people it does not mention stay", async () => {
    await importFile([
      FULL,
      "12,Bruno Soler,Cuenta B,Proyecto B1,Nora Salas,Marta Quiroga,2024-01-01,",
    ]);

    const result = await importWith("EEID,DM,Desde", [
      "11,Marta Quiroga,2024-01-01",
    ]);

    // Bruno is not in the file and it has no Cuenta, Proyecto or Santex Lead
    // column: those stay. It does list DMs, and his is not among them.
    expect(result.counts).toMatchObject({ deleted: 1 });
    expect((await attrs(bruno)).map((r) => r.kind)).toEqual([
      "account",
      "project",
      "santex_lead",
    ]);
    expect((await attrs(ana)).map((r) => r.kind)).toContain("account");
  });
});

describe("the file is the whole list", () => {
  const ROW = (from: string, account = "Cuenta A") =>
    `11,Ana Prieto,${account},Proyecto A1,Marta Quiroga,Nora Salas,${from},`;

  it("a corrected Desde leaves no stale tramo behind", async () => {
    await importFile([ROW("2024-01-01")]);

    const fixed = await importFile([ROW("2024-02-01")]);

    expect(fixed.counts).toMatchObject({ inserted: 1, deleted: 4 });
    expect((await attrs(ana)).map((r) => r.validFrom)).toEqual([
      "2024-02-01",
      "2024-02-01",
      "2024-02-01",
      "2024-02-01",
    ]);
    // The old ones are dropped, not erased.
    expect(
      (await allAttrs(ana)).filter((r) => r.deletedAt !== null),
    ).toHaveLength(4);
  });

  it("drops what a later file no longer lists, and reinstates it when it comes back", async () => {
    await importFile([ROW("2024-01-01"), ROW("2025-01-01", "Cuenta B")]);

    const smaller = await importFile([ROW("2024-01-01")]);

    expect(smaller.counts).toMatchObject({ unchanged: 1, deleted: 4 });
    expect((await attrs(ana)).map((r) => r.validFrom)).not.toContain(
      "2025-01-01",
    );

    const back = await importFile([
      ROW("2024-01-01"),
      ROW("2025-01-01", "Cuenta B"),
    ]);

    expect(back.counts).toMatchObject({ updated: 1, deleted: 0 });
    expect((await attrs(ana)).filter((r) => r.kind === "account")).toHaveLength(
      2,
    );
  });

  it("people the file no longer mentions are dropped too: the file is the list", async () => {
    await importFile([ROW("2024-01-01"), "12,Bruno Soler,Cuenta B,,,,,"]);

    await importFile([ROW("2024-01-01")]);

    expect(await attrs(bruno)).toEqual([]);
    expect(await attrs(ana)).toHaveLength(4);
  });

  it("never drops from an empty file, from one nobody could read, or what another source wrote", async () => {
    await importFile([ROW("2024-01-01")]);
    await insertOrgAttribute({
      personId: bruno,
      kind: "account",
      value: "A mano",
    });

    const empty = await importFile([]);
    const unreadable = await importFile([
      ",Sin Id,Cuenta A,,,,,",
      "11,Ana,,,,,,",
    ]);

    expect(empty.counts.deleted).toBe(0);
    expect(unreadable.counts.deleted).toBe(0);
    expect(await attrs(ana)).toHaveLength(4);
    // A row the app (not the file) wrote is not the file's to drop.
    await importFile([ROW("2024-01-01")]);
    expect((await attrs(bruno)).map((r) => r.value)).toEqual(["A mano"]);
  });

  it("a file uploaded as partial drops nothing, and says so on the run; the same file as complete does", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "org-partial-run-"));
    try {
      const store = {
        uploadsDir: path.join(root, "uploads"),
        profilesDir: path.join(root, "profiles"),
      };
      await importFile([ROW("2024-01-01"), "12,Bruno Soler,Cuenta B,,,,,"]);
      const upload = async () =>
        (
          await storeUpload(
            {
              name: "una-cuenta.xlsx",
              bytes: Buffer.from(
                xlsxFromRows([HEADER.split(","), ROW("2024-01-01").split(",")]),
              ),
            },
            store,
          )
        ).id;
      const params = async (runId: string) =>
        (
          await db
            .select({ params: ingestRun.params })
            .from(ingestRun)
            .where(eq(ingestRun.id, runId))
        )[0].params;

      const partial = await importUpload({
        uploadId: await upload(),
        fileName: "una-cuenta.xlsx",
        profile: { builtin: "org-attributes" },
        partial: true,
        db,
        store,
      });

      expect(partial.counts.deleted).toBe(0);
      expect(await params(partial.runId)).toMatchObject({ partial: true });
      expect((await attrs(bruno)).map((r) => r.value)).toEqual(["Cuenta B"]);

      const whole = await importUpload({
        uploadId: await upload(),
        fileName: "una-cuenta.xlsx",
        profile: { builtin: "org-attributes" },
        db,
        store,
      });

      expect(whole.counts.deleted).toBe(1);
      expect(await params(whole.runId)).not.toHaveProperty("partial");
      expect(await attrs(bruno)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a profile marked partial drops nothing: its file lists only some rows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "org-partial-"));
    const previous = process.env.PROFILES_DIR;
    process.env.PROFILES_DIR = path.join(root, "profiles");
    try {
      const store = {
        uploadsDir: path.join(root, "uploads"),
        profilesDir: path.join(root, "profiles"),
      };
      await saveProfile(
        {
          ...getBuiltinProfile("org-attributes")!,
          name: "org-partial",
          partial: true,
        },
        store,
      );
      await importFile([ROW("2024-01-01"), "12,Bruno Soler,Cuenta B,,,,,"]);
      const stored = await storeUpload(
        {
          name: "parcial.xlsx",
          bytes: Buffer.from(
            xlsxFromRows([HEADER.split(","), ROW("2024-01-01").split(",")]),
          ),
        },
        store,
      );

      const result = await importUpload({
        uploadId: stored.id,
        fileName: "parcial.xlsx",
        profile: { saved: "org-partial" },
        db,
        store,
      });

      expect(result.counts.deleted).toBe(0);
      expect((await attrs(bruno)).map((r) => r.value)).toEqual(["Cuenta B"]);
    } finally {
      if (previous === undefined) delete process.env.PROFILES_DIR;
      else process.env.PROFILES_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});
