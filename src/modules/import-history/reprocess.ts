import type { DbOrTx } from "@/db/client";
import type { IdentityMatchIssue } from "@/db/schema";
import { stagedAssessmentSchema, upsertAssessment } from "./assessment";
import { stagedFeedbackSchema, upsertFeedback } from "./feedback";

/** Report rows (historical import) are the entities this module resolves. */
export const isReportEntity = (entity: string) =>
  entity === "assessment" || entity === "feedback";

/**
 * Re-processes the report row of an issue just settled with `link`: the
 * linked person now answers for the failed name (see resolvedLinks), so the
 * row maps like any other. Another name of the row that still fails raises a
 * new issue. Returns false when the stored payload is not a report row.
 */
export async function reprocessReportRow(
  tx: DbOrTx,
  issue: IdentityMatchIssue,
): Promise<boolean> {
  const stored = { ...(issue.payload as Record<string, unknown>) };
  delete stored.failedRole;
  delete stored.failedName;
  const ctx = {
    source: issue.sourceSystem,
    hash: issue.payloadHash,
    runId: issue.ingestRunId,
    sourceId: issue.sourceId,
    payload: stored,
    cache: new Map<string, unknown>(),
  };
  if (issue.entity === "assessment") {
    const staged = stagedAssessmentSchema.safeParse(stored);
    if (!staged.success) return false;
    await upsertAssessment(tx, staged.data, ctx);
    return true;
  }
  const staged = stagedFeedbackSchema.safeParse(stored);
  if (!staged.success) return false;
  await upsertFeedback(tx, staged.data, ctx);
  return true;
}
