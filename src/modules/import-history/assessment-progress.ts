import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { assessmentProgress, type ProgressStatus } from "@/db/schema";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import { emptyTally, recordRow, resolveRow } from "./assessment";
import { cycleForProgress } from "./cycle-target";
import { ensureParticipant, SOURCE } from "./cycles";

const text = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) =>
    v === null || v === undefined || String(v).trim() === ""
      ? null
      : String(v).trim(),
  );

const STATUS: Record<string, ProgressStatus> = {
  "not started": "not_started",
  "in progress": "in_progress",
  submitted: "submitted",
  complete: "submitted",
  completed: "submitted",
  "n/a": "not_applicable",
  "not applicable": "not_applicable",
};

/** Bamboo's "Self Status" / "Manager Status"; empty = not applicable. */
const status = (label: string) =>
  text.transform((value, ctx) => {
    if (value === null) return "not_applicable" as const;
    const known = STATUS[value.toLowerCase()];
    if (!known) {
      ctx.addIssue({
        code: "custom",
        message: `${label} "${value}" is not a known status (Not Started, In Progress, Submitted)`,
      });
      return z.NEVER;
    }
    return known;
  });

/**
 * A row of Bamboo's Assessment Progress report (profile
 * `bamboo-assessment-progress`): who is at which step of a cycle.
 */
export const stagedProgressSchema = z.object({
  fields: z.object({
    employee_name: text.pipe(z.string({ message: "Employee Name is empty" })),
    manager_name: text,
    department: text,
    review_cycle: text.pipe(z.string({ message: "Review Cycle is empty" })),
    // "Complete" when both sides are done; In Progress / Not Started otherwise.
    assessed: text.transform((v) =>
      v === null
        ? false
        : ["complete", "completed", "yes", "true"].includes(v.toLowerCase()),
    ),
    self_status: status("Self Status"),
    manager_status: status("Manager Status"),
    follow_up_notes: text,
  }),
});
export type StagedProgress = z.infer<typeof stagedProgressSchema>;

/**
 * One Assessment Progress row -> the participant's `assessment_progress` in
 * the cycle the row names. The report has no dates, so the cycle must exist
 * (see cycleForProgress); the participant is added with its as-of snapshot
 * when missing. Same record again (payload hash) = unchanged.
 */
export async function upsertProgress(
  tx: DbOrTx,
  staged: StagedProgress,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  const { fields } = staged;
  const target = await cycleForProgress(tx, ctx, fields.review_cycle);
  if ("deferred" in target) {
    return { result: "deferred", rejects: [], deferral: target.deferred };
  }
  const { cycle } = target;
  const tally = emptyTally();
  const { revieweeId, reviewerId, issue } = await resolveRow(
    tx,
    ctx,
    "assessment_progress",
    ctx.sourceId,
    { reviewee: fields.employee_name, reviewer: fields.manager_name },
  );

  let written: "inserted" | "updated" | "unchanged" | null = null;
  if (revieweeId) {
    const participant = await ensureParticipant(tx, cycle, revieweeId);
    if (participant.created) tally.participantsCreated++;
    const [found] = await tx
      .select({
        id: assessmentProgress.id,
        hash: assessmentProgress.payloadHash,
      })
      .from(assessmentProgress)
      .where(
        and(
          eq(assessmentProgress.cycleId, cycle.id),
          eq(assessmentProgress.participantId, participant.id),
        ),
      );
    if (found && found.hash === ctx.hash) {
      written = "unchanged";
    } else {
      const values = {
        cycleId: cycle.id,
        participantId: participant.id,
        selfStatus: fields.self_status,
        managerStatus: fields.manager_status,
        assessed: fields.assessed,
        followUpNotes: fields.follow_up_notes,
        csvManagerName: fields.manager_name,
        reviewerMismatch:
          reviewerId !== null && reviewerId !== participant.snapManagerPersonId,
        sourceSystem: SOURCE,
        sourceId: ctx.sourceId,
        payloadHash: ctx.hash,
        ingestRunId: ctx.runId,
        updatedAt: new Date(),
      };
      if (found) {
        await tx
          .update(assessmentProgress)
          .set(values)
          .where(eq(assessmentProgress.id, found.id));
        written = "updated";
      } else {
        await tx.insert(assessmentProgress).values(values);
        written = "inserted";
      }
    }
  }

  const result: HandlerOutcome["result"] = issue
    ? "ignoredIssueId" in issue
      ? "ignored"
      : "issues"
    : (written ?? "unchanged");
  await recordRow(tx, {
    runId: ctx.runId,
    entity: "assessment_progress",
    sourceId: ctx.sourceId,
    cycleId: cycle.id,
    result,
    tally,
    issueId: issue && "issueId" in issue ? issue.issueId : null,
  });
  return { result, rejects: [] };
}
