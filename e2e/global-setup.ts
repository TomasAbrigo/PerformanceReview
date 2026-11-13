import { execFileSync } from "node:child_process";

/**
 * Seeds the DB once for the whole run, from the hand-made Bamboo fixtures
 * (3 employees; goals of Ana and Bruno, Carla is terminated). Both ingests are
 * idempotent. Doing it here, and not in each spec's beforeAll, keeps parallel
 * workers from racing on the same tables.
 */
export default function globalSetup() {
  for (const script of ["ingest:employees", "ingest:goals"]) {
    execFileSync("pnpm", [script, "--source", "fixture"], { stdio: "inherit" });
  }
}
