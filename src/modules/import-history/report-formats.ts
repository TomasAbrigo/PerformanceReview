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
 * One schema or the other by the payload's `format` (not a z.union: its
 * "Invalid input" would hide why a row was rejected). The chosen schema's
 * own messages are kept.
 */
function byFormat<A extends z.ZodType, B extends z.ZodType>(
  format: string,
  ofFormat: A,
  legacy: B,
) {
  return z.unknown().transform((value, ctx): z.output<A> | z.output<B> => {
    const isFormat =
      typeof value === "object" &&
      value !== null &&
      (value as { format?: unknown }).format === format;
    const parsed = (isFormat ? ofFormat : legacy).safeParse(value);
    if (parsed.success) return parsed.data as z.output<A> | z.output<B>;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
      });
    }
    return z.NEVER;
  });
}

/**
 * Assessment rows of either shape: Bamboo's raw report (`format:
 * assessments_report`, #83) or the legacy Employee Performance export.
 */
export const stagedAnyAssessmentSchema = byFormat(
  "assessments_report",
  stagedReportSchema,
  stagedAssessmentSchema,
);

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
export const stagedAnyProgressSchema = byFormat(
  "assessment_status",
  stagedStatusSchema,
  stagedProgressSchema,
);

export function upsertAnyProgress(
  tx: DbOrTx,
  staged: StagedStatus | StagedProgress,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  return "format" in staged
    ? upsertStatus(tx, staged, ctx)
    : upsertProgress(tx, staged, ctx);
}
