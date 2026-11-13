import { execFileSync } from "node:child_process";

/**
 * Seeds the DB once, before any spec (specs only read): employees from the
 * hand-made Bamboo fixtures, then their jobInfo/employmentStatus history.
 * Idempotent, so re-running against a seeded DB yields the same data.
 */
export default function globalSetup() {
  for (const entity of ["employee", "job_history"]) {
    execFileSync(
      "pnpm",
      ["ingest:employees", "--source", "fixture", "--entity", entity],
      { stdio: "inherit" },
    );
  }
}
