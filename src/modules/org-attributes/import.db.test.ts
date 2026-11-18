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
import {
  importReportFile,
  importUpload,
  storeUpload,
} from "@/modules/lake/upload";
import { insertPerson } from "@/modules/analytics/test-support";
import { resetAll } from "@/modules/analytics/test-support";

const HEADER = "EEID,Nombre,Cuenta,Proyecto,DM,Santex Lead,Desde,Hasta";
const importFile = (lines: string[]) =>
  writeCsv([HEADER, ...lines]).then((path) =>
    importReportFile(db, { path, profile: "org-attributes" }),
  );

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
