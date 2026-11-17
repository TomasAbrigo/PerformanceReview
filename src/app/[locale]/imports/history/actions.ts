"use server";

import type { ResumeOutcome } from "@/components/imports/cycle-decision";
import { db } from "@/db/client";
import { actionResult } from "@/lib/action-result";
import {
  resumeImportRun,
  ResumeError,
  type ResumeTarget,
} from "@/modules/ingest/resume-run";

const isResumeError = (error: unknown): error is ResumeError =>
  error instanceof ResumeError;

/**
 * Resumes a historical import stopped in `needs_decision` with the cycle
 * People chose: `cycle:<id>` (an existing cycle) or `create:<name>` (one of
 * the proposed ones). The page refreshes with the run's final result.
 */
export async function resumeImportRunAction(
  runId: string,
  choice: string,
): Promise<ResumeOutcome> {
  const target: ResumeTarget | null = choice.startsWith("cycle:")
    ? { cycleId: choice.slice("cycle:".length) }
    : choice.startsWith("create:")
      ? { create: choice.slice("create:".length) }
      : null;
  if (!target) return { ok: false, code: "unknown_cycle" };
  const outcome = await actionResult(async () => {
    await resumeImportRun(db, runId, target);
  }, isResumeError);
  return outcome.ok ? { ok: true } : { ok: false, code: outcome.code };
}
