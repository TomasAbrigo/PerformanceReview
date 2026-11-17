import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DbOrTx } from "@/db/client";
import { DuckDbFileLake } from "@/modules/lake/duckdb-file-lake";
import { FileSourceAdapter } from "@/modules/lake/file-source-adapter";
import { getBuiltinProfile } from "@/modules/lake/profiles";
import { MockProvider, runAnalysis } from "@/modules/qualitative-analysis";
import { runIngest, type RunIngestResult } from "./run-ingest";
import type { SeedSize } from "./seed";

/** Where the synthetic Bamboo report exports of a size live (from the repo root). */
export const seedReportsDir = (size: SeedSize) =>
  path.join("fixtures", "bamboo-reports", size);

/**
 * The reports the seed imports, in order: the performance report creates the
 * semi-annual cycles that assessment progress then fills.
 */
export const SEED_REPORTS = [
  { file: "employee-performance.csv", profile: "bamboo-employee-performance" },
  { file: "assessment-progress.csv", profile: "bamboo-assessment-progress" },
] as const;

export type ReportOutcome = {
  profile: string;
  runId: string;
  status: RunIngestResult["status"];
  counts: RunIngestResult["counts"];
};

/**
 * Imports the report exports of `size` through the same path as an upload
 * (built-in profile, FileSourceAdapter over DuckDB, runIngest in domain mode),
 * in-process. Idempotent: a re-run leaves every row unchanged.
 */
export async function seedReports({
  size,
  db,
  dir = seedReportsDir(size),
}: {
  size: SeedSize;
  db: DbOrTx;
  dir?: string;
}): Promise<ReportOutcome[]> {
  const outcomes: ReportOutcome[] = [];
  for (const report of SEED_REPORTS) {
    const profile = getBuiltinProfile(report.profile);
    if (!profile) throw new Error(`Unknown built-in profile ${report.profile}`);
    const scratch = await mkdtemp(path.join(tmpdir(), "seed-report-"));
    try {
      await copyFile(
        path.resolve(dir, report.file),
        path.join(scratch, `${profile.table}.csv`),
      );
      const lake = await DuckDbFileLake.open(scratch);
      try {
        const result = await runIngest({
          adapter: new FileSourceAdapter(profile, lake, profile.table, {
            source: "bamboo_export",
          }),
          entity: profile.entity,
          db,
          ...(profile.questions ? { questions: profile.questions } : {}),
        });
        outcomes.push({
          profile: report.profile,
          runId: result.runId,
          status: result.status,
          counts: result.counts,
        });
      } finally {
        await lake.close();
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  return outcomes;
}

/** Labels every open-text answer of every cycle with the deterministic MockProvider. */
export const seedAnalysis = (db: DbOrTx) =>
  runAnalysis(db, { provider: new MockProvider() });
