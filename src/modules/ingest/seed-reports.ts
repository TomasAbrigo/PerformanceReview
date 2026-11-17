import path from "node:path";
import type { DbOrTx } from "@/db/client";
import { errorMessage } from "@/lib/log";
import { getBuiltinProfile } from "@/modules/lake/profiles";
import { importReportFile } from "@/modules/lake/upload";
import { seedLikertMappings } from "@/modules/likert/store";
import {
  MockProvider,
  runAnalysis,
  type RunAnalysisResult,
} from "@/modules/qualitative-analysis";
import { seedSystemTemplates } from "@/modules/templates";
import { ingestLockKey } from "./lock";
import { IngestRunError, type RunIngestResult } from "./run-ingest";
import type { SeedSize } from "./seed";

/** Where the synthetic Bamboo report exports of a size live (from the repo root). */
export const seedReportsDir = (size: SeedSize) =>
  path.join("fixtures", "bamboo-reports", size);

/**
 * The reports the seed imports, in the real shapes (#83): the raw
 * assessments report creates the cycles of its review periods, then
 * Assessment Progress fills their completion.
 */
export const SEED_REPORTS = [
  { file: "assessments-report.csv", profile: "bamboo-assessments-report" },
  { file: "assessment-status.csv", profile: "bamboo-assessment-status" },
] as const;

/** The ingest entities the reports write: the seed holds their locks, and a reset refuses while they are held. */
export const REPORT_ENTITIES = SEED_REPORTS.map(
  (r) => getBuiltinProfile(r.profile)!.entity,
);

export type ReportOutcome = {
  profile: string;
  runId?: string;
  status: NonNullable<RunIngestResult["status"]> | "error";
  counts?: RunIngestResult["counts"];
  error?: string;
};

type Lock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

/**
 * Imports the report exports of `size` in-process exactly as an upload of
 * them (`importReportFile`), each under its entity's lock. A report that
 * fails stops the next one (it needs the cycles of the first) but what was
 * imported is still returned. Idempotent: a re-run leaves every row unchanged.
 */
export async function seedReports({
  size,
  db,
  dir = seedReportsDir(size),
  lock = (_key, fn) => fn(),
}: {
  size: SeedSize;
  db: DbOrTx;
  dir?: string;
  lock?: Lock;
}): Promise<ReportOutcome[]> {
  const outcomes: ReportOutcome[] = [];
  for (const report of SEED_REPORTS) {
    const profile = getBuiltinProfile(report.profile)!;
    try {
      const result = await lock(ingestLockKey(profile.entity), () =>
        importReportFile(db, {
          path: path.resolve(dir, report.file),
          profile,
        }),
      );
      const status = result.status ?? "succeeded";
      outcomes.push({
        profile: report.profile,
        runId: result.runId,
        status,
        counts: result.counts,
      });
      if (status !== "succeeded") break;
    } catch (err) {
      outcomes.push({
        profile: report.profile,
        status: "error",
        error: errorMessage(err),
        ...(err instanceof IngestRunError ? { runId: err.runId } : {}),
      });
      break;
    }
  }
  return outcomes;
}

/** Labels every open-text answer of every cycle with the deterministic MockProvider. */
export const seedAnalysis = (db: DbOrTx) =>
  runAnalysis(db, { provider: new MockProvider() });

/**
 * What `pnpm db:seed` does after the ingest: the app's own settings first (the
 * system templates and Likert mappings the server would create on start, so a
 * fresh database works without `pnpm dev`), then the reports and the analysis.
 */
export async function seedInsights({
  size,
  db,
  reports = true,
  analysis = true,
  lock,
  dir,
}: {
  size: SeedSize;
  db: DbOrTx;
  reports?: boolean;
  analysis?: boolean;
  lock?: Lock;
  dir?: string;
}): Promise<{
  reports: ReportOutcome[];
  analysis?: RunAnalysisResult;
  ok: boolean;
}> {
  if (!reports) return { reports: [], ok: true };
  await seedSystemTemplates(db);
  await seedLikertMappings(db);
  const outcomes = await seedReports({ size, db, lock, dir });
  const ok =
    outcomes.length === SEED_REPORTS.length &&
    outcomes.every((o) => o.status === "succeeded");
  if (!ok || !analysis) return { reports: outcomes, ok };
  return { reports: outcomes, analysis: await seedAnalysis(db), ok };
}
