import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { rawRecord } from "@/db/schema";
import { getBuiltinProfile } from "./profiles";
import { storeUpload, type ImportUploadResult } from "./upload";
import { runUploadWorker } from "./upload-worker";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "upload-worker-db-"));
  await db.execute(sql`TRUNCATE raw_record, ingest_run CASCADE`);
});
afterEach(() => rm(root, { recursive: true, force: true }));
afterAll(async () => {
  await db.execute(sql`TRUNCATE raw_record, ingest_run CASCADE`);
  await closeDb();
});

describe("runUploadWorker (import)", () => {
  it("runs the ingest in a separate process and returns the run", async () => {
    const store = { uploadsDir: join(root, "uploads") };
    const stored = await storeUpload(
      {
        name: "employee-performance.csv",
        bytes: await readFile(
          resolve("fixtures/bamboo-reports/small/employee-performance.csv"),
        ),
      },
      store,
    );

    const response = await runUploadWorker<ImportUploadResult>(
      "import",
      {
        uploadId: stored.id,
        fileName: "employee-performance.csv",
        profile: getBuiltinProfile("bamboo-employee-performance"),
      },
      { env: { UPLOADS_DIR: store.uploadsDir } },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.counts).toMatchObject({ read: 69, inserted: 69 });
    expect(response.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db.select().from(rawRecord)).toHaveLength(69);
  }, 60_000);
});
