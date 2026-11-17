import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import {
  type StagedAssessment,
  stagedAssessmentSchema,
  upsertAssessment,
} from "./assessment";
import {
  type StagedProgress,
  stagedProgressSchema,
  upsertProgress,
} from "./assessment-progress";
import {
  type StagedStatus,
  stagedStatusSchema,
  upsertStatus,
} from "./assessment-status";
import {
  type StagedReport,
  stagedReportSchema,
  upsertReportAssessment,
} from "./assessments-report";

/**
 * Assessment rows of either shape: Bamboo's raw report (`format:
 * assessments_report`, #83) or the legacy Employee Performance export.
 */
export const stagedAnyAssessmentSchema = z.union([
  stagedReportSchema,
  stagedAssessmentSchema,
]);

export function upsertAnyAssessment(
  tx: DbOrTx,
  staged: StagedReport | StagedAssessment,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  return "format" in staged
    ? upsertReportAssessment(tx, staged, ctx)
    : upsertAssessment(tx, staged, ctx);
}

/** Assessment Progress rows: the grouped export (#83) or the legacy flat one. */
export const stagedAnyProgressSchema = z.union([
  stagedStatusSchema,
  stagedProgressSchema,
]);

export function upsertAnyProgress(
  tx: DbOrTx,
  staged: StagedStatus | StagedProgress,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  return "format" in staged
    ? upsertStatus(tx, staged, ctx)
    : upsertProgress(tx, staged, ctx);
}
