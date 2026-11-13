import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetIdentityCase } from "./identity-case";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The run id in the summary table row of `entity` printed by `pnpm ingest`. */
function runIdOf(output: string, entity: string) {
  const match = new RegExp(`^${entity}\\s.*\\b(${UUID})\\s*$`, "m").exec(
    output,
  );
  if (!match) throw new Error(`No ${entity} run in the CLI output:\n${output}`);
  return match[1];
}

/** `pnpm ingest ...`: its stdout, and the exit status (the CLI exits 1 when a run fails). */
function ingest(args: string[]) {
  try {
    const stdout = execFileSync("pnpm", ["ingest", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    return { status: 0, stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { status: failure.status ?? 1, stdout: failure.stdout ?? "" };
  }
}

/**
 * Seeds the DB once, before any spec (specs only read), through the same CLI
 * as cron: every registered entity from the hand-made Bamboo fixtures
 * (employees, then their jobInfo/employmentStatus history), twice, so the
 * second run of each is a pure re-run (everything unchanged). Then one run
 * that fails, for the runs log. Idempotent: running it against a seeded DB
 * yields the same data (plus two more runs in the log).
 *
 * The ids of the runs the specs look at are handed over in E2E_RUN_OK (the
 * employee re-run) and E2E_RUN_FAILED (the failed one).
 */
export default async function globalSetup() {
  // The identity spec links a rehire (it runs last): forget it from a previous run.
  await resetIdentityCase();

  const seed = ingest(["--all", "--source", "fixture"]);
  if (seed.status !== 0) throw new Error(`seeding failed:\n${seed.stdout}`);
  const rerun = ingest(["--all", "--source", "fixture"]);
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
