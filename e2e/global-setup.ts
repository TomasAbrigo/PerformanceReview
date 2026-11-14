import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { e2eDatabaseUrl, ensureDatabase } from "./database";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The run id in the summary table row of `entity` printed by `pnpm ingest` / `pnpm db:seed`. */
function runIdOf(output: string, entity: string) {
  const match = new RegExp(`^${entity}\\s.*\\b(${UUID})\\s*$`, "m").exec(
    output,
  );
  if (!match) throw new Error(`No ${entity} run in the CLI output:\n${output}`);
  return match[1];
}

/** `pnpm <script> ...`: its stdout, and the exit status (the CLIs exit 1 when a run fails). */
function run(script: string, args: string[]) {
  try {
    const stdout = execFileSync("pnpm", [script, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    return { status: 0, stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { status: failure.status ?? 1, stdout: failure.stdout ?? "" };
  }
}

const ingest = (args: string[]) => run("ingest", args);

/**
 * Prepares the e2e database and seeds it once, before any spec (specs only
 * read): `pnpm db:seed --size small --reset` (the small generated company:
 * e2e/seed-data.ts has its ground truth), then the same again without --reset,
 * so the second run of each entity is a pure re-run (nothing inserted or
 * updated). Then one run that fails, for the runs log. Idempotent: it starts
 * from empty tables every time, so the specs always see the same data.
 *
 * The ids of the runs the specs look at are handed over in E2E_RUN_OK (the
 * employee re-run) and E2E_RUN_FAILED (the failed one).
 */
export default async function globalSetup() {
  // Its own database (see e2e/database.ts): created and migrated here, and the
  // one the dev server, the seed and the specs' own CLI runs all talk to.
  const databaseUrl = e2eDatabaseUrl();
  await ensureDatabase(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
  const migrated = run("db:migrate", []);
  if (migrated.status !== 0) {
    throw new Error(`migrating the e2e database failed:\n${migrated.stdout}`);
  }

  const seed = run("db:seed", ["--size", "small", "--reset"]);
  if (seed.status !== 0) throw new Error(`seeding failed:\n${seed.stdout}`);
  const rerun = run("db:seed", ["--size", "small"]);
  if (rerun.status !== 0) throw new Error(`re-run failed:\n${rerun.stdout}`);
  process.stdout.write(rerun.stdout);
  process.env.E2E_RUN_OK = runIdOf(rerun.stdout, "employee");

  const broken = mkdtempSync(path.join(tmpdir(), "e2e-broken-"));
  try {
    writeFileSync(path.join(broken, "employees-page-1.json"), "{not json");
    const failed = ingest(["employee", "--source", "fixture", "--dir", broken]);
    if (failed.status !== 1) {
      throw new Error(`the CLI should exit 1, got ${failed.status}`);
    }
    process.env.E2E_RUN_FAILED = runIdOf(failed.stdout, "employee");
  } finally {
    rmSync(broken, { recursive: true, force: true });
  }
}
