import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import { atNoon, emptyTally, recordRow, resolveRow } from "./assessment";
import {
  ensureParticipant,
  isoDate,
  upsertImportedCycle,
  upsertRequest,
} from "./cycles";

const name = (label: string) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v === null || v === undefined ? "" : String(v).trim()))
    .pipe(z.string().min(1, `${label} is empty`));

/** A row of Bamboo's Feedback Status report (profile `bamboo-feedback-status`). */
export const stagedFeedbackSchema = z.object({
  fields: z.object({
    employee_name: name("Employee Name"),
    reviewer_name: name("Receiving Feedback From"),
    review_cycle: name("Review Cycle"),
    completed_on: z.unknown().transform(isoDate),
    due_date: z.unknown().transform(isoDate),
  }),
});
export type StagedFeedback = z.infer<typeof stagedFeedbackSchema>;

/**
 * One Feedback Status row -> a peer request of the imported cycle: submitted
 * on Date Completed, or declined (never completed, as of its due date).
 * Bamboo exports who and when only, so there are no answers.
 */
export async function upsertFeedback(
  tx: DbOrTx,
  staged: StagedFeedback,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  const { fields } = staged;
  const { sourceId } = ctx;
  const date = fields.completed_on ?? fields.due_date;
  if (!date) {
    return {
      result: "rejected",
      rejects: ["Neither Date Completed nor Due Date is a date"],
    };
  }
  const cycle = await upsertImportedCycle(
    tx,
    { name: fields.review_cycle, date, runId: ctx.runId, widen: false },
    { peer: true },
  );
  const tally = emptyTally();
  const { revieweeId, reviewerId, issue } = await resolveRow(
    tx,
    ctx,
    "feedback",
    sourceId,
    { reviewee: fields.employee_name, reviewer: fields.reviewer_name },
  );

  let result: HandlerOutcome["result"];
  if (revieweeId && reviewerId) {
    const participant = await ensureParticipant(tx, cycle, revieweeId);
    if (participant.created) tally.participantsCreated++;
    const request = await upsertRequest(tx, {
      cycleId: cycle.id,
      participantId: participant.id,
      reviewerPersonId: reviewerId,
      relationship: "peer",
      sourceId,
      hash: ctx.hash,
      runId: ctx.runId,
      submittedAt: fields.completed_on ? atNoon(fields.completed_on) : null,
      declinedAt: fields.due_date ? atNoon(fields.due_date) : null,
      csvReviewerName: fields.reviewer_name,
      reviewerMismatch: false,
    });
    if (request.result === "inserted") tally.requestsCreated++;
    if (request.result === "unchanged") tally.requestsUnchanged++;
    result = request.result;
  } else {
    result = issue && "ignoredIssueId" in issue ? "ignored" : "issues";
  }
  await recordRow(tx, {
    runId: ctx.runId,
    entity: "feedback",
    sourceId,
    cycleId: cycle.id,
    result,
    tally,
    issueId: issue && "issueId" in issue ? issue.issueId : null,
  });
  return { result, rejects: [] };
}
