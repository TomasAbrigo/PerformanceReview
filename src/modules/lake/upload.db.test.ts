import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { ingestRun, rawRecord } from "@/db/schema";
import { type SourceProfile } from "./profiles";
import {
  importUpload,
  listProfiles,
  markUploadRunsFailed,
  saveProfile,
  storeUpload,
  UploadError,
  type UploadStore,
} from "./upload";
import type { ProfileChoice } from "./upload-shared";

const REPORTS = resolve("fixtures/bamboo-reports/small");

/** An UploadStore with both folders set. */
type TestStore = UploadStore & { uploadsDir: string; profilesDir: string };

let root: string;
let store: TestStore;
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

const builtin = (name: string): ProfileChoice => ({ builtin: name });

/** The error an import fails with, or undefined if it succeeds. */
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  return error instanceof UploadError ? error : undefined;
}

const feedbackProfile: SourceProfile = {
  name: "mi-feedback",
  table: "mi-feedback",
  keyColumns: ["Employee Name", "Receiving Feedback From", "Review Cycle"],
  entity: "feedback",
  columnMap: { "Employee Name": "employee_name" },
};

describe("importUpload", () => {
  it("lands the employee performance report with its built-in profile and records the upload on the run", async () => {
    const stored = await upload("employee-performance.csv");

    const { runId, counts, rejects } = await importUpload({
      uploadId: stored.id,
      fileName: "Employee Performance.csv",
      profile: builtin("bamboo-employee-performance"),
      landing: true,
      db,
      store,
    });

    expect(counts).toMatchObject({ read: 69, inserted: 69, rejected: 0 });
    expect(rejects).toEqual([]);
    const records = await db.select().from(rawRecord);
    expect(records).toHaveLength(69);
    expect(records.every((r) => r.payloadHash.length === 64)).toBe(true);
    // A Bamboo report export, not a lake table.
    expect(records[0].sourceSystem).toBe("bamboo_export");
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
      profile: builtin("bamboo-employee-performance"),
      landing: true,
      db,
      store,
    });

    const again = await upload("employee-performance.csv", "copia.csv");
    const { counts } = await importUpload({
      uploadId: again.id,
      fileName: "copia.csv",
      profile: builtin("bamboo-employee-performance"),
      landing: true,
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

    const failed = await failure(
      importUpload({
        uploadId: stored.id,
        fileName: "Mis metas.csv",
        profile: builtin("bamboo-employee-performance"),
        landing: true,
        db,
        store,
      }),
    );

    expect(failed?.code).toBe("invalid_profile");
    expect(failed?.message).toContain("bamboo-employee-performance");
    expect(failed?.message).toContain('Column "Review Cycle"');
    // It names the file the user uploaded, not the profile's own table.
    expect(failed?.message).toContain('"Mis metas.csv"');
    expect(failed?.message).not.toContain('table "employee-performance"');
    expect(failed?.issues.map((i) => i.kind)).toContain("missing_column");
    expect(await db.select().from(rawRecord)).toHaveLength(0);
    expect(await db.select().from(ingestRun)).toHaveLength(0);
  });

  it("counts the rows without a key as rejects and lands the rest", async () => {
    const stored = await upload("goal-status.csv");

    const { counts, rejects } = await importUpload({
      uploadId: stored.id,
      fileName: "goal-status.csv",
      profile: builtin("bamboo-goal-status"),
      db,
      store,
    });

    expect(counts).toMatchObject({ read: 119, inserted: 117, rejected: 2 });
    expect(rejects).toHaveLength(2);
    expect(rejects[0].reason).toContain('key column "Goal" is empty');
    expect(rejects[0]).toMatchObject({ code: "empty_key", column: "Goal" });
  });

  it("an unknown built-in profile is refused", async () => {
    const stored = await upload("goal-status.csv");

    const failed = await failure(
      importUpload({
        uploadId: stored.id,
        fileName: "x.csv",
        profile: builtin("no-existe"),
        db,
        store,
      }),
    );

    expect(failed?.code).toBe("unknown_profile");
    expect(await db.select().from(ingestRun)).toHaveLength(0);
  });

  it("refuses an upload id that was never stored", async () => {
    const failed = await failure(
      importUpload({
        uploadId: `${"a".repeat(64)}.csv`,
        fileName: "x.csv",
        profile: builtin("bamboo-goal-status"),
        db,
        store,
      }),
    );

    expect(failed?.code).toBe("unknown_upload");
  });
});

describe("importUpload with a custom profile", () => {
  it("saves it once the import succeeded, lists it, and lands the rows as a lake source", async () => {
    const stored = await upload("feedback-status.csv");

    const { counts } = await importUpload({
      uploadId: stored.id,
      fileName: "feedback-status.csv",
      profile: { custom: feedbackProfile },
      db,
      store,
    });

    expect(counts).toMatchObject({ read: 220, inserted: 220 });
    expect(
      (await listProfiles(store)).find((p) => p.name === "mi-feedback"),
    ).toEqual(feedbackProfile);
    const [row] = await db.select().from(rawRecord).limit(1);
    expect(row).toMatchObject({ entity: "feedback", sourceSystem: "lake" });
  });

  it("is a lake source even when it is named like a Bamboo report", async () => {
    const stored = await upload("feedback-status.csv");

    await importUpload({
      uploadId: stored.id,
      fileName: "feedback-status.csv",
      profile: { custom: { ...feedbackProfile, name: "bamboo-mio" } },
      db,
      store,
    });

    const [row] = await db.select().from(rawRecord).limit(1);
    expect(row.sourceSystem).toBe("lake");
  });

  it("does not save a profile the file does not match", async () => {
    const stored = await upload("feedback-status.csv");

    const failed = await failure(
      importUpload({
        uploadId: stored.id,
        fileName: "feedback-status.csv",
        profile: {
          custom: {
            name: "mal-perfil",
            table: "mal-perfil",
            keyColumns: ["No Existe"],
            entity: "feedback",
            columnMap: {},
          },
        },
        db,
        store,
      }),
    );

    expect(failed?.code).toBe("invalid_profile");
    expect(
      (await listProfiles(store)).some((p) => p.name === "mal-perfil"),
    ).toBe(false);
  });

  it("does not save a profile whose import failed", async () => {
    const stored = await upload("feedback-status.csv");

    const error = await importUpload({
      uploadId: stored.id,
      fileName: "feedback-status.csv",
      profile: { custom: feedbackProfile },
      db,
      store,
      // The worker is told to stop as soon as it starts.
      signal: AbortSignal.abort(new Error("terminated")),
    }).catch((e: unknown) => e);

    expect((error as Error).message).toContain("terminated");
    expect(
      (await listProfiles(store)).some((p) => p.name === "mi-feedback"),
    ).toBe(false);
    const [run] = await db.select().from(ingestRun);
    expect(run.status).toBe("error");
  });

  it("never replaces a built-in profile: a custom one cannot take its name", async () => {
    const stored = await upload("goal-status.csv");

    const failed = await failure(
      importUpload({
        uploadId: stored.id,
        fileName: "goal-status.csv",
        profile: {
          custom: {
            name: "bamboo-goal-status",
            table: "x",
            keyColumns: ["Goal"],
            entity: "goal",
            columnMap: {},
          },
        },
        db,
        store,
      }),
    );

    expect(failed?.code).toBe("profile_exists");
    expect(await db.select().from(ingestRun)).toHaveLength(0);
    expect(await listProfiles(store)).toHaveLength(9);
  });

  it("does not overwrite a saved profile unless asked to", async () => {
    await saveProfile(feedbackProfile, store);
    const stored = await upload("feedback-status.csv");
    const changed = { ...feedbackProfile, columnMap: { Manager: "manager" } };

    const failed = await failure(
      importUpload({
        uploadId: stored.id,
        fileName: "feedback-status.csv",
        profile: { custom: { ...changed, columnMap: {} } },
        db,
        store,
      }),
    );
    expect(failed?.code).toBe("profile_exists");
    expect(await db.select().from(ingestRun)).toHaveLength(0);

    await importUpload({
      uploadId: stored.id,
      fileName: "feedback-status.csv",
      profile: { custom: { ...feedbackProfile, columnMap: {} }, replace: true },
      db,
      store,
    });
    const saved = (await listProfiles(store)).filter(
      (p) => p.name === "mi-feedback",
    );
    expect(saved).toEqual([{ ...feedbackProfile, columnMap: {} }]);
  });

  it("imports with a saved profile as the server has it, whatever the client says", async () => {
    await saveProfile(feedbackProfile, store);
    const stored = await upload("feedback-status.csv");

    const { counts } = await importUpload({
      uploadId: stored.id,
      fileName: "feedback-status.csv",
      profile: { saved: "mi-feedback" },
      db,
      store,
    });

    expect(counts).toMatchObject({ read: 220, inserted: 220 });
    const failed = await failure(
      importUpload({
        uploadId: stored.id,
        fileName: "feedback-status.csv",
        profile: { saved: "nunca-guardado" },
        db,
        store,
      }),
    );
    expect(failed?.code).toBe("unknown_profile");
  });
});

describe("markUploadRunsFailed", () => {
  const sha = "c".repeat(64);
  const longAgo = new Date(Date.now() - 3_600_000);

  async function fakeRun(
    values: Partial<typeof ingestRun.$inferInsert> = {},
  ): Promise<string> {
    const [run] = await db
      .insert(ingestRun)
      .values({
        sourceSystem: "lake",
        adapter: "file",
        entity: "goal",
        params: { sha256: sha },
        status: "running",
        ...values,
      })
      .returning({ id: ingestRun.id });
    return run.id;
  }
  const statusOf = async (id: string) =>
    (await db.select().from(ingestRun).where(eq(ingestRun.id, id)))[0];

  it("fails the runs of that upload that were left running, and only those", async () => {
    const stuck = await fakeRun();
    const otherUpload = await fakeRun({ params: { sha256: "d".repeat(64) } });
    const done = await fakeRun({ status: "succeeded" });
    const older = await fakeRun({ startedAt: longAgo });
    const notAFile = await fakeRun({ adapter: "fixture" });

    const marked = await markUploadRunsFailed(db, {
      sha256: sha,
      since: new Date(Date.now() - 60_000),
      message: "The import took too long and was stopped",
    });

    expect(marked).toBe(1);
    expect(await statusOf(stuck)).toMatchObject({
      status: "error",
      error: "The import took too long and was stopped",
    });
    expect((await statusOf(stuck)).finishedAt).toBeInstanceOf(Date);
    for (const untouched of [otherUpload, done, older, notAFile]) {
      expect((await statusOf(untouched)).error).toBeNull();
    }
    expect((await statusOf(otherUpload)).status).toBe("running");
    expect((await statusOf(done)).status).toBe("succeeded");
  });
});

describe("importUpload of a Bamboo performance report (domain mode)", () => {
  it("imports it as historical cycles unless asked to only land it", async () => {
    await db.execute(sql`TRUNCATE review_cycle, identity_match_issue CASCADE`);
    const stored = await upload("employee-performance.csv");

    const result = await importUpload({
      uploadId: stored.id,
      fileName: "employee-performance.csv",
      profile: builtin("bamboo-employee-performance"),
      db,
      store,
    });

    expect(result.mode).toBe("domain");
    expect(result.counts).toMatchObject({ read: 69, rejected: 0 });
    const cycles = await db.execute(
      sql`select name from review_cycle where source_system = 'bamboo_export'`,
    );
    expect(cycles).toHaveLength(3);
    // A file is not an incremental source: no watermark is kept for it.
    expect(
      await db.execute(sql`select 1 from sync_state where adapter = 'file'`),
    ).toHaveLength(0);
    await db.execute(sql`TRUNCATE review_cycle, identity_match_issue CASCADE`);
  }, 60_000);
});
