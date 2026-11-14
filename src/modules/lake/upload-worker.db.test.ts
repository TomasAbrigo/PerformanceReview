import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { closeDb, db } from "@/db/client";
import { ingestRun, rawRecord } from "@/db/schema";
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
        profile: { builtin: "bamboo-employee-performance" },
      },
      { env: { UPLOADS_DIR: store.uploadsDir } },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.counts).toMatchObject({ read: 69, inserted: 69 });
    expect(response.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db.select().from(rawRecord)).toHaveLength(69);
  }, 60_000);

  it("a worker told to stop marks its run as failed, exits, and saves no profile", async () => {
    const uploadsDir = join(root, "uploads");
    const profilesDir = join(root, "profiles");
    // Long enough to be stopped midway.
    const rows = Array.from({ length: 20_000 }, (_, i) => `${i + 1},P ${i}`);
    const stored = await storeUpload(
      {
        name: "muchas.csv",
        bytes: new TextEncoder().encode(`id,name\n${rows.join("\n")}\n`),
      },
      { uploadsDir },
    );
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/ingest-upload.ts", "import"],
      {
        env: {
          ...process.env,
          UPLOADS_DIR: uploadsDir,
          PROFILES_DIR: profilesDir,
        },
      },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    const exited = new Promise((done) => child.on("close", done));
    child.stdin.end(
      JSON.stringify({
        uploadId: stored.id,
        fileName: "muchas.csv",
        profile: {
          custom: {
            name: "muchas",
            table: "muchas",
            keyColumns: ["id"],
            entity: "goal",
            columnMap: {},
          },
        },
      }),
    );

    // As soon as the ingest is under way, the app gives up on it.
    await vi.waitFor(
      async () => {
        const running = await db
          .select()
          .from(ingestRun)
          .where(eq(ingestRun.status, "running"));
        expect(running).toHaveLength(1);
      },
      { timeout: 30_000, interval: 20 },
    );
    child.kill("SIGTERM");
    await exited;

    const [run] = await db.select().from(ingestRun);
    expect(run.status).toBe("error");
    expect(run.error).toMatch(/terminated/);
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.counts?.read ?? 0).toBeLessThan(20_000);
    expect(JSON.parse(stdout.trim().split("\n").pop() ?? "")).toMatchObject({
      ok: false,
      code: "timeout",
    });
    await expect(readdir(profilesDir)).rejects.toThrow(); // nothing saved
  }, 60_000);
});
