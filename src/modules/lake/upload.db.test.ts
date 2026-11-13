import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { ingestRun, rawRecord } from "@/db/schema";
import { getBuiltinProfile, type SourceProfile } from "./profiles";
import {
  importUpload,
  listProfiles,
  storeUpload,
  UploadError,
  type UploadStore,
} from "./upload";

const REPORTS = resolve("fixtures/bamboo-reports/small");

let root: string;
let store: UploadStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "upload-db-test-"));
  store = {
    uploadsDir: join(root, "uploads"),
    profilesDir: join(root, "profiles"),
  };
  await db.execute(sql`TRUNCATE raw_record, ingest_run CASCADE`);
});
afterEach(() => rm(root, { recursive: true, force: true }));
afterAll(async () => {
  await db.execute(sql`TRUNCATE raw_record, ingest_run CASCADE`);
  await closeDb();
});

async function upload(file: string, name = file) {
  return storeUpload(
    { name, bytes: await readFile(join(REPORTS, file)) },
    store,
  );
}

const profileNamed = (name: string) => getBuiltinProfile(name)!;

describe("importUpload", () => {
  it("lands the employee performance report with its built-in profile and records the upload on the run", async () => {
    const stored = await upload("employee-performance.csv");

    const { runId, counts, rejects } = await importUpload({
      uploadId: stored.id,
      fileName: "Employee Performance.csv",
      profile: profileNamed("bamboo-employee-performance"),
      db,
      store,
    });

    expect(counts).toMatchObject({ read: 69, inserted: 69, rejected: 0 });
    expect(rejects).toEqual([]);
    const records = await db.select().from(rawRecord);
    expect(records).toHaveLength(69);
    expect(records.every((r) => r.payloadHash.length === 64)).toBe(true);
    const [run] = await db
      .select()
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    expect(run).toMatchObject({
      status: "succeeded",
      params: {
        entity: "assessment",
        fileName: "Employee Performance.csv",
        profile: "bamboo-employee-performance",
        size: stored.size,
        sha256: stored.sha256,
      },
    });
  });

  it("importing the same file again, even renamed, creates no new raw_records", async () => {
    const first = await upload("employee-performance.csv");
    await importUpload({
      uploadId: first.id,
      fileName: "a.csv",
      profile: profileNamed("bamboo-employee-performance"),
      db,
      store,
    });

    const again = await upload("employee-performance.csv", "copia.csv");
    const { counts } = await importUpload({
      uploadId: again.id,
      fileName: "copia.csv",
      profile: profileNamed("bamboo-employee-performance"),
      db,
      store,
    });

    expect(again.existed).toBe(true);
    expect(counts).toMatchObject({ read: 69, inserted: 0, unchanged: 69 });
    expect(await db.select().from(rawRecord)).toHaveLength(69);
    expect(await db.select().from(ingestRun)).toHaveLength(2);
  });

  it("rejects a file missing a column the profile needs, before writing anything", async () => {
    // A goal status report is not an employee performance report.
    const stored = await upload("goal-status.csv");

    const error = await importUpload({
      uploadId: stored.id,
      fileName: "goal-status.csv",
      profile: profileNamed("bamboo-employee-performance"),
      db,
      store,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadError);
    const failure = error as UploadError;
    expect(failure.code).toBe("invalid_profile");
    expect(failure.message).toContain("bamboo-employee-performance");
    expect(failure.message).toContain('Column "Review Cycle"');
    expect(failure.issues.map((i) => i.kind)).toContain("missing_column");
    expect(await db.select().from(rawRecord)).toHaveLength(0);
    expect(await db.select().from(ingestRun)).toHaveLength(0);
  });

  it("counts the rows without a key as rejects and lands the rest", async () => {
    const stored = await upload("goal-status.csv");

    const { counts, rejects } = await importUpload({
      uploadId: stored.id,
      fileName: "goal-status.csv",
      profile: profileNamed("bamboo-goal-status"),
      db,
      store,
    });

    expect(counts).toMatchObject({ read: 119, inserted: 117, rejected: 2 });
    expect(rejects).toHaveLength(2);
    expect(rejects[0].reason).toContain('key column "Goal" is empty');
  });

  it("saves a custom profile once the file matches it, and lists it afterwards", async () => {
    const stored = await upload("feedback-status.csv");
    const custom: SourceProfile = {
      name: "mi-feedback",
      table: "mi-feedback",
      keyColumns: ["Employee Name", "Receiving Feedback From", "Review Cycle"],
      entity: "feedback",
      columnMap: { "Employee Name": "employee_name" },
    };

    const { counts } = await importUpload({
      uploadId: stored.id,
      fileName: "feedback-status.csv",
      profile: custom,
      db,
      store,
    });

    expect(counts).toMatchObject({ read: 220, inserted: 220 });
    expect(
      (await listProfiles(store)).find((p) => p.name === "mi-feedback"),
    ).toEqual(custom);
    const [row] = await db.select().from(rawRecord).limit(1);
    expect(row).toMatchObject({ entity: "feedback", sourceSystem: "lake" });
  });

  it("does not save a custom profile the file does not match", async () => {
    const stored = await upload("feedback-status.csv");

    const error = await importUpload({
      uploadId: stored.id,
      fileName: "feedback-status.csv",
      profile: {
        name: "mal-perfil",
        table: "mal-perfil",
        keyColumns: ["No Existe"],
        entity: "feedback",
        columnMap: {},
      },
      db,
      store,
    }).catch((e: unknown) => e);

    expect((error as UploadError).code).toBe("invalid_profile");
    expect(
      (await listProfiles(store)).some((p) => p.name === "mal-perfil"),
    ).toBe(false);
  });

  it("uses the built-in definition when the request only names a built-in profile", async () => {
    const stored = await upload("assessment-progress.csv");
    const forged = {
      ...profileNamed("bamboo-assessment-progress"),
      keyColumns: ["Manager"],
    };

    const { counts } = await importUpload({
      uploadId: stored.id,
      fileName: "assessment-progress.csv",
      profile: forged,
      db,
      store,
    });

    // Keyed by the built-in's (name, cycle, department): 80 distinct rows.
    expect(counts).toMatchObject({ read: 80, inserted: 80 });
  });

  it("refuses an upload id that was never stored", async () => {
    const error = await importUpload({
      uploadId: `${"a".repeat(64)}.csv`,
      fileName: "x.csv",
      profile: profileNamed("bamboo-goal-status"),
      db,
      store,
    }).catch((e: unknown) => e);

    expect((error as UploadError).code).toBe("unknown_upload");
  });
});
