// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBuiltinProfile } from "./profiles";
import { storeUpload, type UploadInspection, type UploadStore } from "./upload";
import { runUploadWorker } from "./upload-worker";

const EMPLOYEE_PERFORMANCE = resolve(
  "fixtures/bamboo-reports/small/employee-performance.csv",
);

/** An UploadStore with both folders set. */
type TestStore = UploadStore & { uploadsDir: string; profilesDir: string };

let root: string;
let store: TestStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "upload-worker-test-"));
  store = {
    uploadsDir: join(root, "uploads"),
    profilesDir: join(root, "profiles"),
  };
});
afterEach(() => rm(root, { recursive: true, force: true }));

const env = () => ({
  UPLOADS_DIR: store.uploadsDir,
  PROFILES_DIR: store.profilesDir,
});

describe("runUploadWorker", () => {
  it("inspects an upload in a separate process", async () => {
    const stored = await storeUpload(
      { name: "ep.csv", bytes: await readFile(EMPLOYEE_PERFORMANCE) },
      store,
    );

    const response = await runUploadWorker<UploadInspection>(
      "inspect",
      { uploadId: stored.id },
      { env: env() },
    );

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.columns[0]).toMatchObject({ name: "Employee Name" });
    expect(response.rows).toHaveLength(20);
  }, 30_000);

  it("reports a failure the user can act on as data, not as a crash", async () => {
    const response = await runUploadWorker(
      "inspect",
      { uploadId: `${"b".repeat(64)}.csv` },
      { env: env() },
    );

    expect(response).toMatchObject({ ok: false, code: "unknown_upload" });
  }, 30_000);

  it("returns the profile issues of a file that does not match", async () => {
    const stored = await storeUpload(
      { name: "x.csv", bytes: new TextEncoder().encode("a,b\n1,2\n") },
      store,
    );

    const response = await runUploadWorker(
      "import",
      {
        uploadId: stored.id,
        fileName: "x.csv",
        profile: getBuiltinProfile("bamboo-goal-status"),
      },
      { env: env() },
    );

    expect(response).toMatchObject({ ok: false, code: "invalid_profile" });
    if (response.ok) return;
    expect(response.issues.length).toBeGreaterThan(0);
    expect(response.message).toContain('Column "Goal"');
  }, 30_000);

  it("rejects input that is not what the command takes", async () => {
    const response = await runUploadWorker(
      "import",
      { uploadId: 3 },
      { env: env() },
    );

    expect(response).toMatchObject({ ok: false, code: "unknown" });
  }, 30_000);

  it("stops a worker that takes too long", async () => {
    const response = await runUploadWorker(
      "inspect",
      { uploadId: `${"b".repeat(64)}.csv` },
      { env: env(), timeoutMs: 1 },
    );

    expect(response).toMatchObject({ ok: false, code: "unknown" });
    if (!response.ok) expect(response.message).toMatch(/timed out/i);
  }, 30_000);
});
